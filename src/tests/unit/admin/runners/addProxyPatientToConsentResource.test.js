const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { AddProxyPatientToConsentResourceRunner } = require('../../../../admin/runners/addProxyPatientToConsentResource');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { MongoDatabaseManager } = require('../../../../utils/mongoDatabaseManager');
const { BwellPersonFinder } = require('../../../../utils/bwellPersonFinder');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('AddProxyPatientToConsentResourceRunner', () => {
    let runner;
    let mockAdminLogger;
    let mockMongoDatabaseManager;
    let mockBwellPersonFinder;
    let mockPreSaveManager;

    beforeEach(() => {
        mockAdminLogger = createMockInstance(AdminLogger);
        mockAdminLogger.logInfo = jestGlobal.fn();
        mockAdminLogger.logError = jestGlobal.fn();
        mockAdminLogger.logger = { warn: jestGlobal.fn() };

        mockMongoDatabaseManager = createMockInstance(MongoDatabaseManager);
        mockMongoDatabaseManager.getClientConfigAsync = jestGlobal.fn().mockResolvedValue({
            connection: 'mongodb://localhost:27017',
            db_name: 'test_db',
            options: {}
        });
        mockMongoDatabaseManager.createClientAsync = jestGlobal.fn();

        mockBwellPersonFinder = createMockInstance(BwellPersonFinder);
        mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jestGlobal.fn().mockResolvedValue({
            patientReferenceToPersonUuid: {}
        });

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jestGlobal.fn().mockImplementation(({ resource }) => resource);

        runner = new AddProxyPatientToConsentResourceRunner({
            batchSize: 100,
            adminLogger: mockAdminLogger,
            mongoDatabaseManager: mockMongoDatabaseManager,
            limit: undefined,
            skip: undefined,
            collections: ['all'],
            startFromId: undefined,
            bwellPersonFinder: mockBwellPersonFinder,
            preSaveManager: mockPreSaveManager,
            useTransaction: undefined,
            beforeLastUpdatedDate: undefined,
            afterLastUpdatedDate: undefined
        });
    });

    describe('constructor', () => {
        test('sets collections to all available when "all" is passed', () => {
            expect(runner.collections).toEqual(['Consent_4_0_0', 'Consent_4_0_0_History']);
        });

        test('filters to valid collections only', () => {
            const r = new AddProxyPatientToConsentResourceRunner({
                batchSize: 100,
                adminLogger: mockAdminLogger,
                mongoDatabaseManager: mockMongoDatabaseManager,
                collections: ['Consent_4_0_0', 'Invalid_Collection'],
                bwellPersonFinder: mockBwellPersonFinder,
                preSaveManager: mockPreSaveManager
            });
            expect(r.collections).toEqual(['Consent_4_0_0']);
        });

        test('initializes caches correctly', () => {
            expect(runner.consentToImmediatePersonCache).toBeInstanceOf(Map);
            expect(runner.consentWithNoPerson).toBeInstanceOf(Map);
            expect(runner.consentToPatientWithMultiplePerson).toBeInstanceOf(Map);
        });
    });

    describe('filterPropExist', () => {
        test('creates $exists filter for given property', () => {
            const result = runner.filterPropExist('patient');
            expect(result).toEqual({ patient: { $exists: true } });
        });

        test('handles nested property names', () => {
            const result = runner.filterPropExist('resource.patient');
            expect(result).toEqual({ 'resource.patient': { $exists: true } });
        });
    });

    describe('getQueryForConsent', () => {
        test('creates query with $and for required properties', async () => {
            const query = await runner.getQueryForConsent({ startFromId: undefined, isHistoryCollection: false });
            expect(query.$and).toBeDefined();
            expect(query.$and.length).toBeGreaterThanOrEqual(2);
            expect(query.$and).toContainEqual({ _uuid: { $exists: true } });
            expect(query.$and).toContainEqual({ patient: { $exists: true } });
        });

        test('adds resource prefix for history collections', async () => {
            const query = await runner.getQueryForConsent({ startFromId: undefined, isHistoryCollection: true });
            expect(query.$and).toContainEqual({ 'resource._uuid': { $exists: true } });
            expect(query.$and).toContainEqual({ 'resource.patient': { $exists: true } });
        });

        test('includes startFromId in query for non-history collection', async () => {
            const query = await runner.getQueryForConsent({ startFromId: 'start-id', isHistoryCollection: false });
            const hasStartId = query.$and.some(q => q._id && q._id.$gte === 'start-id');
            expect(hasStartId).toBe(true);
        });

        test('does not include startFromId for history collection', async () => {
            const query = await runner.getQueryForConsent({ startFromId: 'start-id', isHistoryCollection: true });
            const hasStartId = query.$and.some(q => q._id && q._id.$gte);
            expect(hasStartId).toBe(false);
        });

        test('includes beforeLastUpdatedDate filter', async () => {
            runner.beforeLastUpdatedDate = new Date('2023-12-31');
            const query = await runner.getQueryForConsent({ startFromId: undefined, isHistoryCollection: false });
            const hasDate = query.$and.some(q => q['meta.lastUpdated'] && q['meta.lastUpdated'].$lt);
            expect(hasDate).toBe(true);
        });

        test('includes afterLastUpdatedDate filter', async () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            const query = await runner.getQueryForConsent({ startFromId: undefined, isHistoryCollection: false });
            const hasDate = query.$and.some(q => q['meta.lastUpdated'] && q['meta.lastUpdated'].$gt);
            expect(hasDate).toBe(true);
        });

        test('includes both date filters', async () => {
            runner.afterLastUpdatedDate = new Date('2023-01-01');
            runner.beforeLastUpdatedDate = new Date('2023-12-31');
            const query = await runner.getQueryForConsent({ startFromId: undefined, isHistoryCollection: false });
            const hasDate = query.$and.some(q =>
                q['meta.lastUpdated'] && q['meta.lastUpdated'].$lt && q['meta.lastUpdated'].$gt
            );
            expect(hasDate).toBe(true);
        });
    });

    describe('consentCacheHelper', () => {
        test('calls processPatientReference when both _uuid and patient._uuid present', async () => {
            const mockFn = jestGlobal.fn();
            const doc = { _uuid: 'consent-uuid', _sourceId: 'consent-src', patient: { _uuid: 'Patient/pat-uuid' } };
            await runner.consentCacheHelper({ doc, processPatientReference: mockFn });
            expect(mockFn).toHaveBeenCalledWith('consent-uuid', 'Patient/pat-uuid');
        });

        test('does not call processPatientReference when _uuid is missing', async () => {
            const mockFn = jestGlobal.fn();
            const doc = { _sourceId: 'consent-src', patient: { _uuid: 'Patient/pat-uuid' } };
            await runner.consentCacheHelper({ doc, processPatientReference: mockFn });
            expect(mockFn).not.toHaveBeenCalled();
        });

        test('does not call processPatientReference when patient._uuid is missing', async () => {
            const mockFn = jestGlobal.fn();
            const doc = { _uuid: 'consent-uuid', _sourceId: 'consent-src', patient: {} };
            await runner.consentCacheHelper({ doc, processPatientReference: mockFn });
            expect(mockFn).not.toHaveBeenCalled();
        });

        test('does not call processPatientReference when patient is missing', async () => {
            const mockFn = jestGlobal.fn();
            const doc = { _uuid: 'consent-uuid', _sourceId: 'consent-src' };
            await runner.consentCacheHelper({ doc, processPatientReference: mockFn });
            expect(mockFn).not.toHaveBeenCalled();
        });
    });

    describe('addProxyPersonLinkToConsent', () => {
        test('returns resource unchanged when provision is null', async () => {
            const resource = { _uuid: 'consent-1', provision: null };
            const result = await runner.addProxyPersonLinkToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource
            });
            expect(result).toEqual(resource);
        });

        test('returns resource with warning when no person in cache', async () => {
            const resource = {
                _uuid: 'consent-1',
                provision: { actor: [] },
                patient: { _uuid: 'Patient/patient-1' }
            };

            const result = await runner.addProxyPersonLinkToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource
            });
            expect(result).toEqual(resource);
            expect(runner.consentWithNoPerson.has('consent-1')).toBe(true);
        });

        test('adds proxy patient actor when person is in cache', async () => {
            runner.consentToImmediatePersonCache.set('consent-1', {
                id: 'person-123',
                sourceAssigningAuthority: 'saa'
            });

            const resource = {
                _uuid: 'consent-1',
                provision: { actor: [] },
                patient: { _uuid: 'Patient/patient-1' }
            };

            const result = await runner.addProxyPersonLinkToConsent({
                base_version: '4_0_0',
                requestInfo: {},
                resource
            });

            expect(result.provision.actor.length).toBe(1);
            expect(result.provision.actor[0].reference.reference).toContain('Patient/person.');
        });
    });

    // CACHE ANALYSIS
    // Cache mechanism: this.cache (Map) with sub-maps accessed via Object.defineProperty getters
    // consentToImmediatePersonCache: Map<consentUuid, {id, sourceAssigningAuthority}>
    // Cache KEY: consentUuid
    // Cached VALUE: {id: personId, sourceAssigningAuthority: string}
    // Downstream: addProxyPersonLinkToConsent reads from consentToImmediatePersonCache
    describe('cache behavior', () => {
        test('consentToImmediatePersonCache persists across multiple addProxyPersonLinkToConsent calls', async () => {
            runner.consentToImmediatePersonCache.set('consent-A', {
                id: 'person-A',
                sourceAssigningAuthority: 'saaA'
            });
            runner.consentToImmediatePersonCache.set('consent-B', {
                id: 'person-B',
                sourceAssigningAuthority: 'saaB'
            });

            const resourceA = {
                _uuid: 'consent-A',
                provision: { actor: [] },
                patient: { _uuid: 'Patient/patient-A' }
            };
            const resourceB = {
                _uuid: 'consent-B',
                provision: { actor: [] },
                patient: { _uuid: 'Patient/patient-B' }
            };

            const resultA = await runner.addProxyPersonLinkToConsent({
                base_version: '4_0_0', requestInfo: {}, resource: resourceA
            });
            const resultB = await runner.addProxyPersonLinkToConsent({
                base_version: '4_0_0', requestInfo: {}, resource: resourceB
            });

            expect(resultA.provision.actor[0].reference.reference).toContain('person-A');
            expect(resultB.provision.actor[0].reference.reference).toContain('person-B');
        });
    });
});
