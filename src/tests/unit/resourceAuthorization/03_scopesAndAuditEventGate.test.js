'use strict';

/**
 * Regression tests for docs/resource-authorization.md §3 "Scopes (SMART on FHIR)".
 *
 * Verifies, against the REAL implementations (never a stand-in class):
 *   - ScopesManager parses the four scope namespaces (`user`, `access`, `patient`, `admin`) as
 *     documented in the §3 table.
 *   - ScopesValidator.verifyHasValidScopesAsync (using the real `@asymmetrik/sof-scope-checker`,
 *     not mocked out) rejects a request whose `user` scope is insufficient for the requested
 *     resource type/operation BEFORE any query is built.
 *   - SearchManager.validateAuditEventQueryParameters (the AuditEvent-specific, non-scope-based
 *     pre-query gate) rejects requests missing the configured required filter, and rejects date
 *     ranges wider than configManager.auditEventMaxRangePeriod.
 *
 * Only true external collaborators (ConfigManager, PatientFilterManager, FhirLoggingManager, etc.)
 * are mocked; the classes under test are required from their real source paths.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const { ScopesManager } = require('../../../operations/security/scopesManager');
const { ScopesValidator } = require('../../../operations/security/scopesValidator');
const { SearchManager } = require('../../../operations/search/searchManager');

const { ConfigManager } = require('../../../utils/configManager');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { FhirLoggingManager } = require('../../../operations/common/fhirLoggingManager');
const { PatientScopeManager } = require('../../../operations/security/patientScopeManager');
const { PreSaveManager } = require('../../../preSaveHandlers/preSave');
const { DelegatedAccessScopeManager } = require('../../../operations/security/delegatedAccessScopeManager');

const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { ResourceLocatorFactory } = require('../../../operations/common/resourceLocatorFactory');
const { SecurityTagManager } = require('../../../operations/common/securityTagManager');
const { ResourcePreparer } = require('../../../operations/common/resourcePreparer');
const { IndexHinter } = require('../../../indexes/indexHinter');
const { R4SearchQueryCreator } = require('../../../operations/query/r4');
const { QueryRewriterManager } = require('../../../queryRewriters/queryRewriterManager');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { FhirResourceWriterFactory } = require('../../../operations/streaming/resourceWriters/fhirResourceWriterFactory');
const { DataSharingManager } = require('../../../operations/search/dataSharingManager');
const { SearchQueryBuilder } = require('../../../operations/search/searchQueryBuilder');
const { PatientQueryCreator } = require('../../../operations/common/patientQueryCreator');

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logWarn: jest.fn()
}));

function createMockInstance (ClassType) {
    return Object.create(ClassType.prototype);
}

describe('Resource Authorization §3 — Scopes (SMART on FHIR)', () => {
    describe('ScopesManager — parsing the four scope namespaces', () => {
        /** @type {ScopesManager} */
        let scopesManager;
        let mockConfigManager;
        let mockPatientFilterManager;

        beforeEach(() => {
            mockConfigManager = createMockInstance(ConfigManager);
            mockPatientFilterManager = createMockInstance(PatientFilterManager);
            scopesManager = new ScopesManager({
                configManager: mockConfigManager,
                patientFilterManager: mockPatientFilterManager
            });
        });

        describe('parseScopes', () => {
            test('splits a space-separated scope string into individual scopes', () => {
                expect(scopesManager.parseScopes('user/Patient.read access/tenantA.* patient/Observation.read'))
                    .toEqual(['user/Patient.read', 'access/tenantA.*', 'patient/Observation.read']);
            });

            test('returns empty array for null/undefined/empty scope', () => {
                expect(scopesManager.parseScopes(null)).toEqual([]);
                expect(scopesManager.parseScopes(undefined)).toEqual([]);
                expect(scopesManager.parseScopes('')).toEqual([]);
            });
        });

        describe('getUserScopes — user/<resourceType|*>.<read|write|*>', () => {
            test('returns only the user/ scopes from a mixed scope string', () => {
                const scope = 'user/Patient.read access/tenantA.* patient/Observation.read admin/*.*';
                expect(scopesManager.getUserScopes({ scope })).toEqual(['user/Patient.read']);
            });

            test('returns empty array when no user/ scope present', () => {
                expect(scopesManager.getUserScopes({ scope: 'access/tenantA.*' })).toEqual([]);
            });

            test('returns empty array for falsy scope', () => {
                expect(scopesManager.getUserScopes({ scope: undefined })).toEqual([]);
            });
        });

        describe('getAccessCodesFromScopes — access/<tag|*>.*', () => {
            test('extracts the access tag when the action matches exactly', () => {
                const codes = scopesManager.getAccessCodesFromScopes('read', 'user1', 'access/tenantA.read');
                expect(codes).toEqual(['tenantA']);
            });

            test('extracts the access tag when the scope grants wildcard action (.*)', () => {
                const codes = scopesManager.getAccessCodesFromScopes('write', 'user1', 'access/tenantA.*');
                expect(codes).toEqual(['tenantA']);
            });

            test('does not extract the tag when the requested action does not match', () => {
                const codes = scopesManager.getAccessCodesFromScopes('write', 'user1', 'access/tenantA.read');
                expect(codes).toEqual([]);
            });

            test('collects multiple access tags across multiple access/ scopes', () => {
                const codes = scopesManager.getAccessCodesFromScopes(
                    'read', 'user1', 'access/tenantA.read access/tenantB.* user/Patient.read'
                );
                expect(codes).toEqual(['tenantA', 'tenantB']);
            });

            test('ignores non-access/ scopes entirely', () => {
                const codes = scopesManager.getAccessCodesFromScopes('read', 'user1', 'user/Patient.read patient/Observation.read');
                expect(codes).toEqual([]);
            });
        });

        describe('getPatientScopes — patient/<resourceType|*>.<read|write>', () => {
            test('returns only the patient/ scopes from a mixed scope string', () => {
                const scope = 'user/Patient.read patient/Observation.read patient/Condition.*';
                expect(scopesManager.getPatientScopes({ scope })).toEqual(['patient/Observation.read', 'patient/Condition.*']);
            });

            test('returns empty array for falsy scope', () => {
                expect(scopesManager.getPatientScopes({ scope: null })).toEqual([]);
            });
        });

        describe('getAdminScopes — admin/*.*', () => {
            test('returns only the admin/ scopes from a mixed scope string', () => {
                const scope = 'user/Patient.read admin/*.* access/tenantA.*';
                expect(scopesManager.getAdminScopes({ scope })).toEqual(['admin/*.*']);
            });

            test('returns empty array when no admin/ scope present', () => {
                expect(scopesManager.getAdminScopes({ scope: 'user/Patient.read' })).toEqual([]);
            });

            test('returns empty array for falsy scope', () => {
                expect(scopesManager.getAdminScopes({ scope: undefined })).toEqual([]);
            });
        });

        describe('hasPatientScope', () => {
            test('returns true when a patient/ scope is present', () => {
                expect(scopesManager.hasPatientScope({ scope: 'user/Patient.read patient/Observation.read' })).toBe(true);
            });

            test('returns false when no patient/ scope is present', () => {
                expect(scopesManager.hasPatientScope({ scope: 'user/Patient.read access/tenantA.*' })).toBe(false);
            });
        });
    });

    describe('ScopesValidator.verifyHasValidScopesAsync — pre-query scope gate', () => {
        /** @type {ScopesValidator} */
        let scopesValidator;
        let mockConfigManager;
        let mockPatientFilterManager;
        let mockFhirLoggingManager;
        let mockPatientScopeManager;
        let mockPreSaveManager;
        let mockDelegatedAccessScopeManager;
        let scopesManager;

        beforeEach(() => {
            mockConfigManager = createMockInstance(ConfigManager);
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', {
                get: () => false,
                configurable: true
            });

            mockPatientFilterManager = createMockInstance(PatientFilterManager);
            // No scope under test here carries a patient/ prefix, so this should never actually be
            // consulted to grant access — kept false to make that assumption explicit if it ever is.
            mockPatientFilterManager.canAccessResourceWithPatientScope = jest.fn().mockReturnValue(false);

            // Real ScopesManager (and real @asymmetrik/sof-scope-checker underneath it via
            // ScopesValidator) so the scope-sufficiency check is genuinely exercised, not stubbed.
            scopesManager = new ScopesManager({
                configManager: mockConfigManager,
                patientFilterManager: mockPatientFilterManager
            });

            mockFhirLoggingManager = createMockInstance(FhirLoggingManager);
            mockFhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

            mockPatientScopeManager = createMockInstance(PatientScopeManager);
            mockPreSaveManager = createMockInstance(PreSaveManager);
            mockDelegatedAccessScopeManager = createMockInstance(DelegatedAccessScopeManager);

            scopesValidator = new ScopesValidator({
                scopesManager,
                fhirLoggingManager: mockFhirLoggingManager,
                configManager: mockConfigManager,
                patientScopeManager: mockPatientScopeManager,
                preSaveManager: mockPreSaveManager,
                delegatedAccessScopeManager: mockDelegatedAccessScopeManager
            });
        });

        test('rejects with ForbiddenError when the user scope does not cover the requested resource type', async () => {
            // Holds user/Patient.read + a valid access tag, but is requesting Observation.read —
            // the sof-scope-checker should find no matching scope for Observation.
            const requestInfo = {
                user: 'service-account-1',
                scope: 'user/Patient.read access/tenantA.read'
            };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: { getRawArgs: () => ({}) },
                resourceType: 'Observation',
                startTime: Date.now(),
                action: 'search',
                accessRequested: 'read'
            })).rejects.toThrow(/failed access check to \[Observation\.read\]/);

            // The gate must fire before any query-building logging/telemetry treats this as a
            // legitimate request.
            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('rejects with ForbiddenError when the user scope covers the type but not the requested action (write vs read)', async () => {
            const requestInfo = {
                user: 'service-account-1',
                scope: 'user/Observation.read access/tenantA.read'
            };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: { getRawArgs: () => ({}) },
                resourceType: 'Observation',
                startTime: Date.now(),
                action: 'update',
                accessRequested: 'write'
            })).rejects.toThrow(/failed access check to \[Observation\.write\]/);
        });

        test('allows the request through when the user scope + an access code cover the resource type/action', async () => {
            const requestInfo = {
                user: 'service-account-1',
                scope: 'user/Observation.read access/tenantA.read'
            };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: { getRawArgs: () => ({}) },
                resourceType: 'Observation',
                startTime: Date.now(),
                action: 'search',
                accessRequested: 'read'
            })).resolves.toBeUndefined();

            expect(mockFhirLoggingManager.logOperationFailureAsync).not.toHaveBeenCalled();
        });

        test('rejects when the user scope is sufficient but no access/ code is granted at all', async () => {
            // Per §1/§7, a user/ scope alone (no access/ tag, no wildcard) grants no visibility
            // into any tenant's data, so this must still be rejected before query construction.
            const requestInfo = {
                user: 'service-account-1',
                scope: 'user/Observation.read'
            };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: { getRawArgs: () => ({}) },
                resourceType: 'Observation',
                startTime: Date.now(),
                action: 'search',
                accessRequested: 'read'
            })).rejects.toThrow(/has no access scopes/);
        });

        test('rejects with ForbiddenError when no scope is present at all', async () => {
            const requestInfo = { user: 'service-account-1', scope: undefined };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: { getRawArgs: () => ({}) },
                resourceType: 'Observation',
                startTime: Date.now(),
                action: 'search',
                accessRequested: 'read'
            })).rejects.toThrow(/no scopes/);
        });
    });

    describe('SearchManager — AuditEvent-specific pre-query gate (not scope-based)', () => {
        /** @type {SearchManager} */
        let searchManager;
        let mockConfigManager;

        beforeEach(() => {
            const mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
            const mockResourceLocatorFactory = createMockInstance(ResourceLocatorFactory);
            const mockSecurityTagManager = createMockInstance(SecurityTagManager);
            const mockResourcePreparer = createMockInstance(ResourcePreparer);
            const mockIndexHinter = createMockInstance(IndexHinter);
            const mockR4SearchQueryCreator = createMockInstance(R4SearchQueryCreator);
            mockConfigManager = createMockInstance(ConfigManager);
            const mockQueryRewriterManager = createMockInstance(QueryRewriterManager);
            const mockScopesManager = createMockInstance(ScopesManager);
            const mockDatabaseAttachmentManager = createMockInstance(DatabaseAttachmentManager);
            const mockBase64DataManager = createMockInstance(Base64DataManager);
            const mockFhirResourceWriterFactory = createMockInstance(FhirResourceWriterFactory);
            const mockDataSharingManager = createMockInstance(DataSharingManager);
            const mockSearchQueryBuilder = createMockInstance(SearchQueryBuilder);
            const mockPatientScopeManager = createMockInstance(PatientScopeManager);
            const mockPatientQueryCreator = createMockInstance(PatientQueryCreator);

            // Matches the documented default (30) — overridden per-test where needed.
            Object.defineProperty(mockConfigManager, 'requiredFiltersForAuditEvent', {
                value: ['date'], writable: true, configurable: true
            });
            Object.defineProperty(mockConfigManager, 'auditEventMaxRangePeriod', {
                value: 30, writable: true, configurable: true
            });

            searchManager = new SearchManager({
                databaseQueryFactory: mockDatabaseQueryFactory,
                resourceLocatorFactory: mockResourceLocatorFactory,
                securityTagManager: mockSecurityTagManager,
                resourcePreparer: mockResourcePreparer,
                indexHinter: mockIndexHinter,
                r4SearchQueryCreator: mockR4SearchQueryCreator,
                configManager: mockConfigManager,
                queryRewriterManager: mockQueryRewriterManager,
                scopesManager: mockScopesManager,
                databaseAttachmentManager: mockDatabaseAttachmentManager,
                base64DataManager: mockBase64DataManager,
                fhirResourceWriterFactory: mockFhirResourceWriterFactory,
                dataSharingManager: mockDataSharingManager,
                searchQueryBuilder: mockSearchQueryBuilder,
                patientScopeManager: mockPatientScopeManager,
                patientQueryCreator: mockPatientQueryCreator
            });
        });

        test('rejects the whole request when the required filter (date) is entirely missing', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({}))
                .toThrow(/is required to query AuditEvent/);
        });

        test('rejects when only one of gt/ge or lt/le is supplied (unbounded range)', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({ date: ['ge2024-01-01'] }))
                .toThrow(/Atleast two operations lt\/le and gt\/ge/);
        });

        test('rejects when the date range exceeds configManager.auditEventMaxRangePeriod', () => {
            // auditEventMaxRangePeriod is 30 (days); this range spans ~2 years.
            expect(() => searchManager.validateAuditEventQueryParameters({
                date: ['ge2023-01-01', 'le2024-12-31']
            })).toThrow(/should not be greater than 30/);
        });

        test('allows a request whose date range is within auditEventMaxRangePeriod', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({
                date: ['ge2024-01-01', 'le2024-01-07']
            })).not.toThrow();
        });

        test('respects a configured non-default auditEventMaxRangePeriod', () => {
            Object.defineProperty(mockConfigManager, 'auditEventMaxRangePeriod', {
                value: 5, writable: true, configurable: true
            });

            expect(() => searchManager.validateAuditEventQueryParameters({
                date: ['ge2024-01-01', 'le2024-01-10']
            })).toThrow(/should not be greater than 5/);
        });

        test('does not require the date filter at all when configManager.requiredFiltersForAuditEvent is not set', () => {
            Object.defineProperty(mockConfigManager, 'requiredFiltersForAuditEvent', {
                value: null, writable: true, configurable: true
            });

            expect(() => searchManager.validateAuditEventQueryParameters({})).not.toThrow();
        });

        test('rejects a malformed date operator (not one of gt/ge/lt/le)', () => {
            expect(() => searchManager.validateAuditEventQueryParameters({
                date: ['xx2024-01-01', 'le2024-01-07']
            })).toThrow(/is not a valid query/);
        });
    });
});
