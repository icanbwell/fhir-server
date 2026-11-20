'use strict';

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

// NOTE: this project's jest config applies no transform to source files, so babel-jest's
// automatic hoisting of `jest.mock()` above requires does not happen here. Every `jest.mock()`
// below MUST stay physically above the `require('../../../utils/delegatedAccessRulesManager')`
// line (and any other require of a mocked module) -- otherwise the module under test captures
// the real (unmocked) dependency in its own closure at require-time, silently.
jest.mock('../../../utils/referenceParser', () => ({
    ReferenceParser: {
        parseReference: jest.fn().mockReturnValue({
            id: 'actor-1',
            resourceType: 'Practitioner',
            sourceAssigningAuthority: undefined
        })
    }
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
const { RethrownError } = require('../../../utils/rethrownError');

const RELATED_PERSON_UUID = 'fc2b3779-1db9-4780-bea1-73dc941b02a7';
const GRANTOR_PERSON_UUID = '7b99904f-2f85-51a3-9398-e2eed6854639';
const CONSENT_UUID = '6db13a4f-fee5-485a-b245-18881c0232ac';
const ACTOR_REFERENCE = `RelatedPerson/${RELATED_PERSON_UUID}`;
const CONSENT_REFERENCE = `Consent/${CONSENT_UUID}`;

/**
 * A stored Consent that passes every check for ACTOR_REFERENCE acting for GRANTOR_PERSON_UUID.
 * References carry the `_uuid`/`_sourceId` fields the server adds on write.
 */
const buildValidConsent = () => ({
    _uuid: CONSENT_UUID,
    meta: { versionId: '3' },
    status: 'active',
    category: [{
        coding: [{ system: 'http://www.icanbwell.com/consent-category', code: 'dataSharingAccess' }]
    }],
    patient: {
        reference: `Patient/person.${GRANTOR_PERSON_UUID}`,
        _uuid: `Patient/person.${GRANTOR_PERSON_UUID}`,
        _sourceId: `Patient/person.${GRANTOR_PERSON_UUID}`
    },
    provision: {
        type: 'permit',
        period: { start: '2024-01-01T00:00:00.000Z', end: '2099-12-31T00:00:00.000Z' },
        actor: [{ reference: { reference: ACTOR_REFERENCE, _uuid: ACTOR_REFERENCE } }]
    }
});

const useRealReferenceParser = () => {
    ReferenceParser.parseReference.mockImplementation(
        jest.requireActual('../../../utils/referenceParser').ReferenceParser.parseReference
    );
};

const restoreDefaultReferenceParserMock = () => {
    ReferenceParser.parseReference.mockReset();
    ReferenceParser.parseReference.mockReturnValue({
        id: 'actor-1',
        resourceType: 'Practitioner',
        sourceAssigningAuthority: undefined
    });
};

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

    /**
     * Makes the Consent collection return `consents` for any query.
     * @param {Object[]} consents
     * @return {{ findAsync: jest.Mock }}
     */
    const mockConsentLookupReturning = (consents) => {
        const mockCursor = {
            maxTimeMS: jest.fn(),
            getCollection: jest.fn().mockReturnValue('Consent_4_0_0'),
            explainAsync: jest.fn().mockResolvedValue([{ stage: 'IDHACK' }]),
            toArrayAsync: jest.fn().mockResolvedValue(consents)
        };
        const mockDatabaseQueryManager = {
            findAsync: jest.fn().mockResolvedValue(mockCursor)
        };
        mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);
        return mockDatabaseQueryManager;
    };

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
        beforeEach(() => {
            useRealReferenceParser();
            logWarn.mockClear();
        });

        afterEach(() => {
            restoreDefaultReferenceParserMock();
        });

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
                reference: ACTOR_REFERENCE,
                entitlements: [CONSENT_REFERENCE],
                _filteringRules: {
                    consentId: 'cached-consent',
                    consentVersion: '1'
                }
            };
            mockConsentLookupReturning([buildValidConsent()]);

            const result = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID,
                _debug: true
            });

            // Should have queried the DB (not used cache)
            expect(mockCustomTracer.trace).toHaveBeenCalled();
            expect(result.filteringRules.consentId).toBe(CONSENT_UUID);
            expect(result.actorConsentQueries[0].explanations).toEqual([{ stage: 'IDHACK' }]);
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

        it.each([
            ['no entitlements', undefined],
            ['only a purpose code', ['FAMRQT']],
            ['a non-string entry', [42]],
            ['two Consent entries', [CONSENT_REFERENCE, 'Consent/0b0f8a4e-2c7d-4e1a-9f3b-5d6c7e8f9a0b']]
        ])('refuses without reading Consent when the token has %s', async (_label, entitlements) => {
            const actor = { reference: ACTOR_REFERENCE, entitlements };

            const result = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID
            });

            expect(result.filteringRules).toBeNull();
            expect(actor._filteringRules).toBeNull();
            expect(mockDatabaseQueryFactory.createQuery).not.toHaveBeenCalled();
            expect(logWarn).toHaveBeenCalledWith('Delegated Consent refused', expect.objectContaining({
                args: { consentReference: null }
            }));
        });

        it.each([
            ['is not found', []],
            ['matches more than one Consent', [buildValidConsent(), buildValidConsent()]],
            ['fails a check', [{ ...buildValidConsent(), status: 'inactive' }]]
        ])('refuses when the named Consent %s', async (_label, consents) => {
            const actor = { reference: ACTOR_REFERENCE, entitlements: [CONSENT_REFERENCE] };
            mockConsentLookupReturning(consents);

            const result = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID
            });

            expect(result.filteringRules).toBeNull();
            expect(actor._filteringRules).toBeNull();
            expect(logWarn).toHaveBeenCalledWith('Delegated Consent refused', expect.objectContaining({
                args: { consentReference: CONSENT_REFERENCE }
            }));
        });

        it('reads the named Consent by uuid once per actor and leaves purposeOfUse to the token', async () => {
            const actor = { reference: ACTOR_REFERENCE, entitlements: [CONSENT_REFERENCE, 'FAMRQT'] };
            const mockDatabaseQueryManager = mockConsentLookupReturning([buildValidConsent()]);

            const first = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID
            });
            const second = await manager.getFilteringRulesAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID
            });

            expect(first.filteringRules.consentId).toBe(CONSENT_UUID);
            expect(second.filteringRules).toBe(first.filteringRules);
            expect(actor.purposeOfUse).toBeUndefined();
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(1);
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({ query: { _uuid: CONSENT_UUID } });
        });

        it.each([
            ['a plain error', () => new Error('connection reset')],
            // DatabaseCursor/DatabaseQueryManager wrap driver errors in RethrownError, which sets 500.
            ['a RethrownError from the data layer', () => new RethrownError({ error: new Error('server selection timed out') })]
        ])('propagates %s from the lookup as transient (503) instead of refusing with 403', async (_label, buildError) => {
            const actor = { reference: ACTOR_REFERENCE, entitlements: [CONSENT_REFERENCE] };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockRejectedValue(buildError())
            });

            await expect(
                manager.getFilteringRulesAsync({ actor, personIdFromJwtToken: GRANTOR_PERSON_UUID })
            ).rejects.toMatchObject({ isTransient: true, statusCode: 503 });
            expect(actor._filteringRules).toBeUndefined();
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

        it('returns true for an Organization actor without querying the database or setting a bogus consentPolicy', async () => {
            ReferenceParser.parseReference.mockReturnValueOnce({
                id: 'org-1',
                resourceType: 'Organization',
                sourceAssigningAuthority: undefined
            });
            const actor = { reference: 'Organization/org-1', isOrganizationActor: true };

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: 'person-123'
            });

            expect(result).toBe(true);
            expect(mockDatabaseQueryFactory.createQuery).not.toHaveBeenCalled();
            expect(actor.consentPolicy).toBeUndefined();
        });

        it('should return false when no consent found', async () => {
            useRealReferenceParser();
            const actor = { reference: ACTOR_REFERENCE, entitlements: [CONSENT_REFERENCE] };
            mockConsentLookupReturning([]);

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID
            });

            expect(result).toBe(false);
            expect(actor.consentPolicy).toBeUndefined();
        });

        it('should return true and set consentPolicy when consent found', async () => {
            useRealReferenceParser();
            const actor = { reference: ACTOR_REFERENCE, entitlements: [CONSENT_REFERENCE] };
            mockConsentLookupReturning([buildValidConsent()]);

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID
            });

            expect(result).toBe(true);
            expect(actor.consentPolicy).toBe(`Consent/${CONSENT_UUID}?version=3`);
        });

        it('BUG: consentVersion undefined produces malformed consentPolicy string', async () => {
            // When consent has no meta.versionId, consentVersion will be undefined
            // The consentPolicy string becomes: "Consent/consent-id?version=undefined"
            useRealReferenceParser();
            const actor = { reference: ACTOR_REFERENCE, entitlements: [CONSENT_REFERENCE] };
            const consentWithoutMeta = buildValidConsent();
            delete consentWithoutMeta.meta;
            mockConsentLookupReturning([consentWithoutMeta]);

            const result = await manager.hasValidConsentAsync({
                actor,
                personIdFromJwtToken: GRANTOR_PERSON_UUID
            });

            expect(result).toBe(true);
            // EXPECTED: correct behavior (will fail until bug is fixed)
            // consentPolicy should NOT contain "version=undefined" - should omit version or handle gracefully
            expect(actor.consentPolicy).not.toContain('undefined');
        });
    });

    describe('resolvePurposeOfEventCodesAsync', () => {
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

        it('should reject as a transient error (isTransient/503), not resolve to null, when the Consent lookup errors', async () => {
            // A DB/lookup error is not proof the Consent doesn't exist -- it must surface as a
            // retryable error, not the permanent 401 a genuine "not found"
            // produces. See authService.verify()'s existing .catch() handling for this class of
            // error (mirrors getUserInfoFromUserInfoEndpoint/JWKS failures).
            ReferenceParser.parseReference.mockReturnValue({
                id: 'consent-id',
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockRejectedValue(new Error('mongo timeout'))
            });

            await expect(
                manager.resolvePurposeOfEventCodesAsync({ entitlements: ['Consent/consent-id'] })
            ).rejects.toMatchObject({
                message: 'mongo timeout',
                isTransient: true,
                statusCode: 503
            });
            expect(logWarn).toHaveBeenCalled();
        });

        it('should not overwrite an already-set statusCode on a transient lookup error', async () => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'consent-id',
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            const customError = new Error('rate limited');
            customError.statusCode = 429;
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockRejectedValue(customError)
            });

            await expect(
                manager.resolvePurposeOfEventCodesAsync({ entitlements: ['Consent/consent-id'] })
            ).rejects.toMatchObject({ isTransient: true, statusCode: 429 });
        });

        it('should return null (ambiguous) when a bare, authority-less id matches more than one Consent, without leaking either match', async () => {
            ReferenceParser.parseReference.mockReturnValue({
                id: 'shared-bare-id',
                resourceType: 'Consent',
                sourceAssigningAuthority: undefined
            });

            const mockCursor = {
                maxTimeMS: jest.fn(),
                toArrayAsync: jest.fn().mockResolvedValue([
                    { provision: { purpose: [{ code: 'TREAT' }] } },
                    { provision: { purpose: [{ code: 'HPAYMT' }] } }
                ])
            };
            const mockDatabaseQueryManager = { findAsync: jest.fn().mockResolvedValue(mockCursor) };
            mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);

            const result = await manager.resolvePurposeOfEventCodesAsync({
                entitlements: ['Consent/shared-bare-id']
            });

            expect(result).toBeNull();
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({ query: { _sourceId: 'shared-bare-id' } });
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

        it('should query by _sourceId when there is no uuid and no sourceAssigningAuthority', async () => {
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
                query: { _sourceId: 'raw-id-456' }
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

        describe('allowed connection types', () => {
            const consentUuid = '123e4567-e89b-12d3-a456-426614174004';
            const connectionTypeSystem = 'https://www.icanbwell.com/connectionType';

            const mockConsentLookup = (securityLabel) => {
                ReferenceParser.parseReference.mockReturnValue({
                    id: consentUuid,
                    resourceType: 'Consent',
                    sourceAssigningAuthority: undefined
                });
                mockDatabaseQueryFactory.createQuery.mockReturnValue({
                    findAsync: jest.fn().mockResolvedValue({
                        maxTimeMS: jest.fn(),
                        toArrayAsync: jest.fn().mockResolvedValue([
                            { _uuid: consentUuid, provision: { purpose: [{ code: 'TREAT' }], securityLabel } }
                        ])
                    })
                });
            };

            it.each([
                ['no securityLabel (fails closed)', undefined, []],
                ['only non-connectionType labels (fails closed)', [{ system: 'https://www.icanbwell.com/other', code: 'x' }], []],
                ['one connection type', [{ system: connectionTypeSystem, code: 'treatment' }], ['treatment']],
                [
                    'several connection types',
                    [{ system: connectionTypeSystem, code: 'treatment' }, { system: connectionTypeSystem, code: 'proa' }],
                    ['treatment', 'proa']
                ],
                ['a differently-cased system', [{ system: connectionTypeSystem.toUpperCase(), code: 'treatment' }], ['treatment']],
                ['a single label object instead of an array', { system: connectionTypeSystem, code: 'treatment' }, ['treatment']],
                ['a label with no code (fails closed)', [{ system: connectionTypeSystem }], []],
                [
                    'a valid and a malformed label (fails closed)',
                    [{ system: connectionTypeSystem, code: 'treatment' }, { system: connectionTypeSystem, code: '' }],
                    []
                ]
            ])('sets actor.allowedConnectionTypes for a Consent with %s', async (_label, securityLabel, expected) => {
                mockConsentLookup(securityLabel);
                const actor = { reference: 'Organization/org-1', isOrganizationActor: true };

                const result = await manager.resolvePurposeOfEventCodesAsync({
                    entitlements: [`Consent/${consentUuid}`],
                    actor
                });

                expect(result).toEqual(['TREAT']);
                expect(actor.allowedConnectionTypes).toEqual(expected);
            });

            it('logs the Consent id, not the label contents, when a connectionType label is malformed', async () => {
                mockConsentLookup([{ system: connectionTypeSystem }]);

                await manager.resolvePurposeOfEventCodesAsync({
                    entitlements: [`Consent/${consentUuid}`],
                    actor: { reference: 'Organization/org-1', isOrganizationActor: true }
                });

                expect(logWarn).toHaveBeenCalledWith(
                    expect.stringContaining('malformed'),
                    expect.objectContaining({ args: { consentId: consentUuid } })
                );
            });

            it.each([
                ['no securityLabel', undefined],
                ['a connectionType label', [{ system: connectionTypeSystem, code: 'treatment' }]]
            ])('does not set allowedConnectionTypes for a RelatedPerson actor whose Consent has %s', async (_label, securityLabel) => {
                mockConsentLookup(securityLabel);
                const actor = { reference: 'RelatedPerson/rp-1', isOrganizationActor: false };

                const result = await manager.resolvePurposeOfEventCodesAsync({
                    entitlements: [`Consent/${consentUuid}`],
                    actor
                });

                expect(result).toEqual(['TREAT']);
                expect(actor).not.toHaveProperty('allowedConnectionTypes');
            });

            it('resolves purpose codes without an actor', async () => {
                mockConsentLookup([{ system: connectionTypeSystem, code: 'treatment' }]);

                const result = await manager.resolvePurposeOfEventCodesAsync({
                    entitlements: [`Consent/${consentUuid}`]
                });

                expect(result).toEqual(['TREAT']);
            });
        });
    });

    describe('Consent checks', () => {
        beforeEach(() => {
            useRealReferenceParser();
        });

        afterEach(() => {
            restoreDefaultReferenceParserMock();
        });

        it.each([
            ['a uuid reference by _uuid', { _uuid: ACTOR_REFERENCE }, ACTOR_REFERENCE, true],
            ['a uuid reference stored under another uuid', { _uuid: 'RelatedPerson/other' }, ACTOR_REFERENCE, false],
            [
                'an id with its source assigning authority',
                { _sourceId: 'RelatedPerson/rp-1', _sourceAssigningAuthority: 'client-1' },
                'RelatedPerson/rp-1|client-1',
                true
            ],
            [
                'an id with another source assigning authority',
                { _sourceId: 'RelatedPerson/rp-1', _sourceAssigningAuthority: 'client-2' },
                'RelatedPerson/rp-1|client-1',
                false
            ],
            [
                'a person proxy patient as the server stores it',
                {
                    _uuid: `Patient/person.${GRANTOR_PERSON_UUID}`,
                    _sourceId: `Patient/person.${GRANTOR_PERSON_UUID}`
                },
                `Patient/person.${GRANTOR_PERSON_UUID}`,
                true
            ],
            ['a missing stored reference', undefined, ACTOR_REFERENCE, false]
        ])('referenceMatches %s', (_label, storedReference, reference, expected) => {
            expect(DelegatedAccessRulesManager.referenceMatches(storedReference, reference)).toBe(expected);
        });

        const now = new Date('2025-12-24T20:00:00.000Z');
        const otherRelatedPerson = 'RelatedPerson/0e6f9a35-8b0c-4c47-9b1a-2f3d4e5f6a7b';

        it.each([
            ['the valid Consent', () => {}, true],
            ['an inactive Consent', (c) => { c.status = 'inactive'; }, false],
            ['a deny provision', (c) => { c.provision.type = 'deny'; }, false],
            ['no data-sharing category', (c) => { c.category = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IDSCL' }] }]; }, false],
            ['no period', (c) => { delete c.provision.period; }, false],
            ['a start in the future', (c) => { c.provision.period.start = '2025-12-25T00:00:00.000Z'; }, false],
            ['an unparseable start', (c) => { c.provision.period.start = 'not-a-date'; }, false],
            ['an empty-string start', (c) => { c.provision.period.start = ''; }, false],
            ['an empty-string end', (c) => { c.provision.period.end = ''; }, false],
            ['empty-string start and end', (c) => { c.provision.period = { start: '', end: '' }; }, false],
            ['an end in the past', (c) => { c.provision.period.end = '2025-12-24T00:00:00.000Z'; }, false],
            ['a date-only end earlier today', (c) => { c.provision.period.end = '2025-12-24'; }, false],
            ['only a past start', (c) => { delete c.provision.period.end; }, true],
            ['only a future end', (c) => { delete c.provision.period.start; }, true],
            [
                'another grantor',
                (c) => { c.patient = { reference: 'Patient/person.other', _sourceId: 'Patient/person.other' }; },
                false
            ],
            [
                'another delegate',
                (c) => { c.provision.actor = [{ reference: { reference: otherRelatedPerson, _uuid: otherRelatedPerson } }]; },
                false
            ],
            ['no provision actor', (c) => { delete c.provision.actor; }, false],
            [
                'the delegate as the second actor',
                (c) => { c.provision.actor.unshift({ reference: { reference: otherRelatedPerson, _uuid: otherRelatedPerson } }); },
                true
            ]
        ])('consentGrantsAccess for %s', (_label, mutate, expected) => {
            const consent = buildValidConsent();
            mutate(consent);

            const grantsAccess = manager.consentGrantsAccess({
                consent,
                actorReference: ACTOR_REFERENCE,
                personIdFromJwtToken: GRANTOR_PERSON_UUID,
                now
            });

            expect(grantsAccess).toBe(expected);
        });
    });
});
