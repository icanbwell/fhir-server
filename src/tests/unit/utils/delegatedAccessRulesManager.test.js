'use strict';

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

// NOTE: this project's jest config applies no transform to source files, so babel-jest's
// automatic hoisting of `jest.mock()` above requires does not happen here. Every `jest.mock()`
// below MUST stay physically above the `require('../../../utils/delegatedAccessRulesManager')`
// line (and any other require of a mocked module) -- otherwise the module under test captures
// the real (unmocked) dependency in its own closure at require-time, silently.
jest.mock('../../../utils/mongoQuerySimplifier', () => ({
    MongoQuerySimplifier: {
        simplifyFilter: jest.fn(({ filter }) => filter)
    }
}));

jest.mock('../../../operations/query/filters/searchFilterFromReference', () => ({
    SearchFilterFromReference: {
        buildFilter: jest.fn().mockReturnValue([{ 'patient._uuid': { $in: ['person.person-123'] } }])
    }
}));

jest.mock('../../../utils/referenceParser', () => ({
    ReferenceParser: {
        parseReference: jest.fn().mockReturnValue({
            id: 'actor-1',
            resourceType: 'Practitioner',
            sourceAssigningAuthority: undefined
        })
    }
}));

jest.mock('../../../utils/querybuilder.util', () => ({
    dateQueryBuilder: jest.fn().mockReturnValue({ $lte: '2026-01-01' })
}));

jest.mock('../../../operations/common/logging', () => ({
    logWarn: jest.fn()
}));

const { DelegatedAccessRulesManager } = require('../../../utils/delegatedAccessRulesManager');
const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { CustomTracer } = require('../../../utils/customTracer');
const { ReferenceParser } = require('../../../utils/referenceParser');
const { generateUUIDv5 } = require('../../../utils/uid.util');
const { logWarn } = require('../../../operations/common/logging');

describe('DelegatedAccessRulesManager', () => {
    let manager;
    let mockConfigManager;
    let mockDatabaseQueryFactory;
    let mockCustomTracer;

    beforeEach(() => {
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'mongoTimeout', { get: () => 30000, configurable: true });
        Object.defineProperty(mockConfigManager, 'dataSharingAccessCodes', { get: () => ['dataSharingAccess'], configurable: true });

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jest.fn();

        mockCustomTracer = Object.create(CustomTracer.prototype);
        mockCustomTracer.trace = jest.fn(({ func }) => func());

        manager = new DelegatedAccessRulesManager({
            configManager: mockConfigManager,
            databaseQueryFactory: mockDatabaseQueryFactory,
            customTracer: mockCustomTracer
        });
    });

    describe('parseConsentFilteringRules', () => {
        it('should extract basic consent filtering rules', () => {
            const consent = {
                _uuid: 'consent-uuid-123',
                meta: { versionId: '2' },
                provision: {
                    period: {
                        start: '2024-01-01',
                        end: '2025-12-31'
                    }
                }
            };

            const result = manager.parseConsentFilteringRules({ consent });

            expect(result.consentId).toBe('consent-uuid-123');
            expect(result.consentVersion).toBe('2');
            expect(result.provisionPeriodStart).toBe('2024-01-01');
            expect(result.provisionPeriodEnd).toBe('2025-12-31');
        });

        it('should handle consent without provision period', () => {
            const consent = {
                _uuid: 'consent-uuid-456',
                meta: { versionId: '1' },
                provision: {}
            };

            const result = manager.parseConsentFilteringRules({ consent });

            expect(result.consentId).toBe('consent-uuid-456');
            expect(result.consentVersion).toBe('1');
            expect(result.provisionPeriodStart).toBeUndefined();
            expect(result.provisionPeriodEnd).toBeUndefined();
        });

        it('should handle consent without meta', () => {
            const consent = {
                _uuid: 'consent-uuid-789',
                provision: {
                    period: { start: '2024-01-01' }
                }
            };

            const result = manager.parseConsentFilteringRules({ consent });

            expect(result.consentId).toBe('consent-uuid-789');
            expect(result.consentVersion).toBeUndefined();
            expect(result.provisionPeriodStart).toBe('2024-01-01');
            expect(result.provisionPeriodEnd).toBeUndefined();
        });

        it('should extract denied sensitive categories from nested provisions', () => {
            const consent = {
                _uuid: 'consent-uuid-abc',
                meta: { versionId: '1' },
                provision: {
                    period: { start: '2024-01-01' },
                    provision: [
                        {
                            type: 'deny',
                            securityLabel: [
                                {
                                    system: 'https://www.icanbwell.com/sensitivity-category',
                                    code: 'mental-health'
                                },
                                {
                                    system: 'https://www.icanbwell.com/sensitivity-category',
                                    code: 'substance-abuse'
                                }
                            ]
                        }
                    ]
                }
            };

            const result = manager.parseConsentFilteringRules({ consent });

            // deniedSensitiveCategories is stored as non-enumerable
            expect(result.deniedSensitiveCategories).toEqual(['mental-health', 'substance-abuse']);
        });

        it('should handle case-insensitive system matching for sensitive categories', () => {
            const consent = {
                _uuid: 'consent-uuid-case',
                meta: { versionId: '1' },
                provision: {
                    period: { start: '2024-01-01' },
                    provision: [
                        {
                            type: 'deny',
                            securityLabel: [
                                {
                                    system: 'HTTPS://WWW.ICANBWELL.COM/SENSITIVITY-CATEGORY',
                                    code: 'mental-health'
                                }
                            ]
                        }
                    ]
                }
            };

            const result = manager.parseConsentFilteringRules({ consent });

            // Case insensitive matching should find the category
            expect(result.deniedSensitiveCategories).toEqual(['mental-health']);
        });

        it('should skip non-deny provisions', () => {
            const consent = {
                _uuid: 'consent-uuid-permit',
                meta: { versionId: '1' },
                provision: {
                    period: { start: '2024-01-01' },
                    provision: [
                        {
                            type: 'permit',
                            securityLabel: [
                                {
                                    system: 'https://www.icanbwell.com/sensitivity-category',
                                    code: 'mental-health'
                                }
                            ]
                        }
                    ]
                }
            };

            const result = manager.parseConsentFilteringRules({ consent });

            expect(result.deniedSensitiveCategories).toEqual([]);
        });

        it('should skip security labels without code', () => {
            const consent = {
                _uuid: 'consent-uuid-nocode',
                meta: { versionId: '1' },
                provision: {
                    period: { start: '2024-01-01' },
                    provision: [
                        {
                            type: 'deny',
                            securityLabel: [
                                {
                                    system: 'https://www.icanbwell.com/sensitivity-category'
                                    // no code!
                                }
                            ]
                        }
                    ]
                }
            };

            const result = manager.parseConsentFilteringRules({ consent });

            expect(result.deniedSensitiveCategories).toEqual([]);
        });

        it('BUG: securityLabel that is not an array causes TypeError', () => {
            // If securityLabel is a single object instead of an array,
            // the for...of loop on line 159 will try to iterate a non-iterable
            const consent = {
                _uuid: 'consent-uuid-badlabel',
                meta: { versionId: '1' },
                provision: {
                    period: { start: '2024-01-01' },
                    provision: [
                        {
                            type: 'deny',
                            securityLabel: {
                                system: 'https://www.icanbwell.com/sensitivity-category',
                                code: 'mental-health'
                            }
                            // securityLabel is a single object, not an array!
                        }
                    ]
                }
            };

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should handle non-array securityLabel gracefully (wrap in array or skip)
            const result = manager.parseConsentFilteringRules({ consent });
            expect(result.deniedSensitiveCategories).toEqual(['mental-health']);
        });

        it('should store deniedSensitiveCategories as non-enumerable', () => {
            const consent = {
                _uuid: 'consent-uuid-enum',
                meta: { versionId: '1' },
                provision: {
                    period: { start: '2024-01-01' },
                    provision: [
                        {
                            type: 'deny',
                            securityLabel: [
                                {
                                    system: 'https://www.icanbwell.com/sensitivity-category',
                                    code: 'hiv'
                                }
                            ]
                        }
                    ]
                }
            };

            const result = manager.parseConsentFilteringRules({ consent });

            // Should not appear in JSON serialization
            const serialized = JSON.stringify(result);
            expect(serialized).not.toContain('deniedSensitiveCategories');
            // But should be accessible directly
            expect(result.deniedSensitiveCategories).toEqual(['hiv']);
        });

        it('should handle provision.provision that is not an array', () => {
            const consent = {
                _uuid: 'consent-uuid-notarray',
                meta: { versionId: '1' },
                provision: {
                    period: { start: '2024-01-01' },
                    provision: 'not-an-array'
                }
            };

            // The check on line 155 does Array.isArray(consent.provision.provision)
            // so this should be handled gracefully (non-array skipped)
            const result = manager.parseConsentFilteringRules({ consent });
            expect(result.deniedSensitiveCategories).toEqual([]);
        });
    });

    describe('getFilteringRulesAsync', () => {
        it('should return cached filtering rules when available', async () => {
            const actor = {
                reference: 'Practitioner/actor-1',
                _filteringRules: {
                    consentId: 'cached-consent',
                    consentVersion: '1',
                    provisionPeriodStart: '2024-01-01',
                    provisionPeriodEnd: '2025-12-31'
                }
            };

            const result = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result.filteringRules).toBe(actor._filteringRules);
            expect(result.actorConsentQueries).toEqual([]);
            expect(result.actorConsentQueryOptions).toEqual([]);
            // customTracer.trace should NOT have been called (cache hit)
            expect(mockCustomTracer.trace).not.toHaveBeenCalled();
        });

        it('should bypass cache when _debug is true', async () => {
            const actor = {
                reference: 'Practitioner/actor-1',
                _filteringRules: {
                    consentId: 'cached-consent',
                    consentVersion: '1'
                }
            };

            // Mock the fetch to return something different
            const mockCursor = {
                maxTimeMS: jest.fn(),
                hint: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([{ stage: 'IXSCAN' }]),
                toArrayAsync: jest.fn().mockResolvedValue([{
                    _uuid: 'new-consent',
                    meta: { versionId: '2' },
                    provision: { period: { start: '2025-01-01' } }
                }])
            };

            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            const result = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: 'person-123',
                _debug: true
            });

            // Should have queried the DB (not used cache)
            expect(mockCustomTracer.trace).toHaveBeenCalled();
            expect(result.filteringRules.consentId).toBe('new-consent');
        });

        it('BUG: cached _filteringRules set to null is treated as "no cache" on subsequent calls', async () => {
            // When filteringRules is null (no consent found), it gets cached as:
            // actor._filteringRules = null
            // On next call, the cache check is:
            // if (!_debug && actor._filteringRules !== undefined)
            // null !== undefined is TRUE, so cache IS used. This is correct.
            const actor = {
                reference: 'Practitioner/actor-1',
                _filteringRules: null  // cached null (no consent)
            };

            const result = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result.filteringRules).toBeNull();
            expect(mockCustomTracer.trace).not.toHaveBeenCalled();
        });

        it('should return null filteringRules when no consent found', async () => {
            const actor = { reference: 'Practitioner/actor-1' };

            const mockCursor = {
                maxTimeMS: jest.fn(),
                hint: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                toArrayAsync: jest.fn().mockResolvedValue([])
            };

            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            const result = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result.filteringRules).toBeNull();
            // Should cache the null result on actor
            expect(actor._filteringRules).toBeNull();
        });

        it('should throw ForbiddenError when multiple consents found', async () => {
            const actor = { reference: 'Practitioner/actor-1' };

            const mockCursor = {
                maxTimeMS: jest.fn(),
                hint: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                toArrayAsync: jest.fn().mockResolvedValue([
                    { _uuid: 'consent-1', meta: { versionId: '1' } },
                    { _uuid: 'consent-2', meta: { versionId: '1' } }
                ])
            };

            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            await expect(
                manager.getFilteringRulesAsync({
                    actor,
                    personIdFromJwtToken: 'person-123'
                })
            ).rejects.toThrow('ambiguous permissions');
        });
    });

    describe('hasValidConsentAsync', () => {
        afterEach(() => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'actor-1',
                resourceType: 'Practitioner',
                sourceAssigningAuthority: undefined
            });
        });

        it('DCON-5395/RFC: returns true for an Organization actor without querying the database or setting a bogus consentPolicy', async () => {
            ReferenceParser.parseReference.mockReturnValueOnce({
                id: 'org-1',
                resourceType: 'Organization',
                sourceAssigningAuthority: undefined
            });
            const actor = { reference: 'Organization/org-1' };

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result).toBe(true);
            expect(mockDatabaseQueryFactory.createQuery).not.toHaveBeenCalled();
            expect(actor.consentPolicy).toBeUndefined();
        });

        it('should return false when no consent found', async () => {
            const actor = { reference: 'Practitioner/actor-1' };

            const mockCursor = {
                maxTimeMS: jest.fn(),
                hint: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                toArrayAsync: jest.fn().mockResolvedValue([])
            };

            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result).toBe(false);
            expect(actor.consentPolicy).toBeUndefined();
        });

        it('should return true and set consentPolicy when consent found', async () => {
            const actor = { reference: 'Practitioner/actor-1' };

            const mockCursor = {
                maxTimeMS: jest.fn(),
                hint: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                toArrayAsync: jest.fn().mockResolvedValue([{
                    _uuid: 'consent-abc',
                    meta: { versionId: '3' },
                    provision: { period: { start: '2024-01-01', end: '2026-12-31' } }
                }])
            };

            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result).toBe(true);
            expect(actor.consentPolicy).toBe('Consent/consent-abc?version=3');
        });

        it('BUG: consentVersion undefined produces malformed consentPolicy string', async () => {
            // When consent has no meta.versionId, consentVersion will be undefined
            // The consentPolicy string becomes: "Consent/consent-id?version=undefined"
            const actor = { reference: 'Practitioner/actor-1' };

            const mockCursor = {
                maxTimeMS: jest.fn(),
                hint: jest.fn(),
                getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
                explainAsync: jest.fn().mockResolvedValue([]),
                toArrayAsync: jest.fn().mockResolvedValue([{
                    _uuid: 'consent-no-meta',
                    // No meta field!
                    provision: { period: { start: '2024-01-01', end: '2026-12-31' } }
                }])
            };

            const mockDatabaseQueryManager = {
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result).toBe(true);
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // consentPolicy should NOT contain "version=undefined" - should omit version or handle gracefully
            expect(actor.consentPolicy).not.toContain('undefined');
        });
    });

    describe('resolvePurposeOfEventCodesAsync (DCON-5395)', () => {
        afterEach(() => {
            ReferenceParser.parseReference.mockReset();
            ReferenceParser.parseReference.mockReturnValue({
                id: 'actor-1',
                resourceType: 'Practitioner',
                sourceAssigningAuthority: undefined
            });
        });

        it('should return null when entitlements is null', async () => {
            const result = await manager.resolvePurposeOfEventCodesAsync({ entitlements: null });
            expect(result).toBeNull();
        });

        it('should return an empty array unchanged when entitlements is empty', async () => {
            const result = await manager.resolvePurposeOfEventCodesAsync({ entitlements: [] });
            expect(result).toEqual([]);
        });

        it('should pass legacy bare v3-ActReason codes through unchanged', async () => {
            ReferenceParser.parseReference.mockImplementation((reference) => ({
                id: reference,
                resourceType: undefined,
                sourceAssigningAuthority: undefined
            }));

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['FAMRQT', 'TREAT']
            });

            expect(result).toEqual(['FAMRQT', 'TREAT']);
            expect(mockDatabaseQueryFactory.createQuery).not.toHaveBeenCalled();
        });

        it("should resolve a Consent/<id> reference to the Consent's provision.purpose codes", async () => {
            const consentUuid = '123e4567-e89b-12d3-a456-426614174000';
            ReferenceParser.parseReference.mockReturnValue({
                id: consentUuid,
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        provision: {
                            purpose: [
                                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }
                            ]
                        }
                    }
                ])
            };
            const mockDatabaseQueryManager = { findAsync: jest.fn().mockResolvedValue(mockCursor) };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: [`Consent/${consentUuid}`]
            });

            expect(result).toEqual(['TREAT']);
            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Consent',
                base_version: '4_0_0'
            });
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({
                query: { _uuid: consentUuid }
            });
        });

        it('should resolve multiple purpose codings from a single Consent', async () => {
            const consentUuid = '123e4567-e89b-12d3-a456-426614174001';
            ReferenceParser.parseReference.mockReturnValue({
                id: consentUuid,
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        provision: {
                            purpose: [
                                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' },
                                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HPAYMT' }
                            ]
                        }
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: [`Consent/${consentUuid}`]
            });

            expect(result).toEqual(['TREAT', 'HPAYMT']);
        });

        it('should mix legacy bare codes and a resolved Consent reference in one entitlements array', async () => {
            const consentUuid = '123e4567-e89b-12d3-a456-426614174002';
            ReferenceParser.parseReference.mockImplementation((reference) => {
                if (reference === `Consent/${consentUuid}`) {
                    return { id: consentUuid, resourceType: 'Consent', sourceAssigningAuthority: undefined };
                }
                return { id: reference, resourceType: undefined, sourceAssigningAuthority: undefined };
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([
                    { provision: { purpose: [{ code: 'TREAT' }] } }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['FAMRQT', `Consent/${consentUuid}`]
            });

            expect(result).toEqual(['FAMRQT', 'TREAT']);
        });

        it('should return null (and log a warning), not throw, when the referenced Consent cannot be found', async () => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'missing-consent-id',
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['Consent/missing-consent-id']
            });

            // null (not []) signals "could not resolve" to the caller, which now fails the
            // request closed instead of silently proceeding with an empty purposeOfEvent.
            expect(result).toBeNull();
            expect(logWarn).toHaveBeenCalled();
        });

        it('should return null (and log a warning), not throw, when the Consent lookup errors', async () => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'consent-id',
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockRejectedValue(new Error('mongo timeout'))
            });

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['Consent/consent-id']
            });

            expect(result).toBeNull();
            expect(logWarn).toHaveBeenCalled();
        });

        it('should return null overall when a Consent-reference entitlement is unresolvable, even alongside other entitlements', async () => {
            ReferenceParser.parseReference.mockImplementation((reference) => {
                if (reference === 'Consent/missing-consent-id') {
                    return { id: 'missing-consent-id', resourceType: 'Consent', sourceAssigningAuthority: undefined };
                }
                return { id: reference, resourceType: undefined, sourceAssigningAuthority: undefined };
            });

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue({
                    maxTimeMS: jest.fn(),
                    toArrayAsync: jest.fn().mockResolvedValue([])
                })
            });

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['FAMRQT', 'Consent/missing-consent-id']
            });

            expect(result).toBeNull();
        });

        it('should query by a deterministic uuid when the reference carries a sourceAssigningAuthority', async () => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'raw-id-123',
                resourceType: 'Consent',
                sourceAssigningAuthority: 'authority-1'
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([{ provision: { purpose: [{ code: 'TREAT' }] } }])
            };
            const mockDatabaseQueryManager = { findAsync: jest.fn().mockResolvedValue(mockCursor) };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['Consent/raw-id-123|authority-1']
            });

            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({
                query: { _uuid: generateUUIDv5('raw-id-123|authority-1') }
            });
        });

        it('should query by bare id when there is no uuid and no sourceAssigningAuthority', async () => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'raw-id-456',
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([{ provision: { purpose: [{ code: 'TREAT' }] } }])
            };
            const mockDatabaseQueryManager = { findAsync: jest.fn().mockResolvedValue(mockCursor) };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['Consent/raw-id-456']
            });

            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({
                query: { id: 'raw-id-456' }
            });
        });

        it('should return an empty array when the Consent has no provision.purpose', async () => {
            const consentUuid = '123e4567-e89b-12d3-a456-426614174003';
            ReferenceParser.parseReference.mockReturnValue({
                id: consentUuid,
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([{ provision: {} }])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: [`Consent/${consentUuid}`]
            });

            expect(result).toEqual([]);
        });
    });
});
