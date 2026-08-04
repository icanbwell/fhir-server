'use strict';

const { describe, test, beforeEach, expect, jest: jestObj } = require('@jest/globals');

// Mock assertTypeEquals to be a no-op so we can pass plain mocks
jestObj.mock('../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

// Mock FhirOperationsManager to avoid its transitive ESM dependency chain
jestObj.mock('../../../operations/fhirOperationsManager', () => {
    class FhirOperationsManager {
        getRequestInfo() { return { requestId: 'req-123', method: 'GET', headers: {} }; }
    }
    return { FhirOperationsManager };
});

// Mock EverythingOperation to avoid its transitive dependency chain
jestObj.mock('../../../operations/everything/everything', () => {
    class EverythingOperation {
        async everythingAsync() { return { entry: [] }; }
    }
    return { EverythingOperation };
});

const { AdminPersonPatientDataManager } = require('../../../admin/adminPersonPatientDataManager');
const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
const { EverythingOperation } = require('../../../operations/everything/everything');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../../dataLayer/databaseUpdateFactory');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const Bundle = require('../../../fhir/classes/4_0_0/resources/bundle');

function createPrototypedMock(RealClass) {
    return Object.create(RealClass.prototype);
}

function createManager() {
    const fhirOperationsManager = createPrototypedMock(FhirOperationsManager);
    fhirOperationsManager.getRequestInfo = jestObj.fn().mockReturnValue({
        requestId: 'req-123',
        method: 'GET',
        headers: {}
    });

    const everythingOperation = createPrototypedMock(EverythingOperation);
    everythingOperation.everythingAsync = jestObj.fn().mockResolvedValue(
        new Bundle({ entry: [] })
    );

    const databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
    const mockQueryManager = {
        findAsync: jestObj.fn().mockResolvedValue({
            toArrayAsync: jestObj.fn().mockResolvedValue([])
        })
    };
    databaseQueryFactory.createQuery = jestObj.fn().mockReturnValue(mockQueryManager);

    const databaseUpdateFactory = createPrototypedMock(DatabaseUpdateFactory);
    const mockUpdateManager = {
        replaceOneAsync: jestObj.fn().mockResolvedValue({ savedResource: {} })
    };
    databaseUpdateFactory.createDatabaseUpdateManager = jestObj.fn().mockReturnValue(mockUpdateManager);

    const r4ArgsParser = createPrototypedMock(R4ArgsParser);
    r4ArgsParser.parseArgs = jestObj.fn().mockReturnValue({ id: 'test-id' });

    const postSaveProcessor = createPrototypedMock(PostSaveProcessor);
    postSaveProcessor.afterSaveAsync = jestObj.fn().mockResolvedValue(undefined);

    const inst = new AdminPersonPatientDataManager({
        fhirOperationsManager,
        everythingOperation,
        databaseQueryFactory,
        databaseUpdateFactory,
        r4ArgsParser,
        postSaveProcessor
    });

    return {
        manager: inst,
        mocks: {
            fhirOperationsManager,
            everythingOperation,
            databaseQueryFactory,
            databaseUpdateFactory,
            queryManager: mockQueryManager,
            updateManager: mockUpdateManager,
            r4ArgsParser,
            postSaveProcessor
        }
    };
}

describe('AdminPersonPatientDataManager', () => {
    let manager;
    let mocks;

    beforeEach(() => {
        const setup = createManager();
        manager = setup.manager;
        mocks = setup.mocks;
    });

    describe('deletePatientDataGraphAsync', () => {
        test('calls getRequestInfo and sets method to DELETE', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

            await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-1', responseStreamer
            });

            expect(mocks.fhirOperationsManager.getRequestInfo).toHaveBeenCalledWith(req);
        });

        test('calls everythingOperation with resourceType Patient', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

            await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-1', responseStreamer
            });

            expect(mocks.everythingOperation.everythingAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Patient',
                    responseStreamer: null
                })
            );
        });

        test('calls r4ArgsParser with Patient resourceType and id', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

            await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-42', responseStreamer
            });

            expect(mocks.r4ArgsParser.parseArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Patient',
                    args: expect.objectContaining({ id: 'pat-42' })
                })
            );
        });

        test('calls removeLinksFromOtherPersonsAsync when method is DELETE', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };
            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-pat-1', id: 'pat-1' } }
                ]
            });
            mocks.everythingOperation.everythingAsync.mockResolvedValue(bundle);

            // Mock the query manager to return empty for linked persons
            mocks.queryManager.findAsync.mockResolvedValue({
                toArrayAsync: jestObj.fn().mockResolvedValue([])
            });

            await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-1', responseStreamer, method: 'DELETE'
            });

            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Person' })
            );
        });

        test('does NOT call removeLinksFromOtherPersonsAsync when method is not DELETE', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

            await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-1', responseStreamer, method: 'GET'
            });

            // Should not call databaseQueryFactory (which is only called in removeLinks)
            expect(mocks.databaseQueryFactory.createQuery).not.toHaveBeenCalled();
        });

        test('streams bundle entries to responseStreamer', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };
            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-1', id: 'p1' } },
                    { resource: { resourceType: 'Observation', _uuid: 'uuid-2', id: 'o1' } }
                ]
            });
            mocks.everythingOperation.everythingAsync.mockResolvedValue(bundle);

            await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-1', responseStreamer, method: 'GET'
            });

            expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalledTimes(2);
        });

        test('returns the bundle', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };
            const bundle = new Bundle({ entry: [] });
            mocks.everythingOperation.everythingAsync.mockResolvedValue(bundle);

            const result = await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-1', responseStreamer, method: 'GET'
            });

            expect(result).toBe(bundle);
        });

        test('throws RethrownError when everythingAsync fails', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };
            mocks.everythingOperation.everythingAsync.mockRejectedValue(new Error('everything failed'));

            await expect(
                manager.deletePatientDataGraphAsync({
                    req, res, patientId: 'pat-1', responseStreamer
                })
            ).rejects.toThrow();
        });
    });

    describe('deletePersonDataGraphAsync', () => {
        test('calls everythingOperation with resourceType Person', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

            await manager.deletePersonDataGraphAsync({
                req, res, personId: 'per-1', responseStreamer
            });

            expect(mocks.everythingOperation.everythingAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Person'
                })
            );
        });

        test('calls r4ArgsParser with Person resourceType and personId', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

            await manager.deletePersonDataGraphAsync({
                req, res, personId: 'per-99', responseStreamer
            });

            expect(mocks.r4ArgsParser.parseArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Person',
                    args: expect.objectContaining({ id: 'per-99' })
                })
            );
        });

        test('uses DELETE method by default', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };
            const bundle = new Bundle({ entry: [] });
            mocks.everythingOperation.everythingAsync.mockResolvedValue(bundle);

            // Mock query manager for removeLinks
            mocks.queryManager.findAsync.mockResolvedValue({
                toArrayAsync: jestObj.fn().mockResolvedValue([])
            });

            await manager.deletePersonDataGraphAsync({
                req, res, personId: 'per-1', responseStreamer
            });

            // DELETE method should trigger removeLinksFromOtherPersonsAsync
            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalled();
        });

        test('throws RethrownError on failure with person id in message', async () => {
            const req = {};
            const res = {};
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };
            mocks.everythingOperation.everythingAsync.mockRejectedValue(new Error('fail'));

            await expect(
                manager.deletePersonDataGraphAsync({
                    req, res, personId: 'per-1', responseStreamer
                })
            ).rejects.toThrow();
        });
    });

    describe('removeLinksFromOtherPersonsAsync', () => {
        test('creates query and update managers for Person resourceType', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            const bundle = new Bundle({ entry: [] });

            await manager.removeLinksFromOtherPersonsAsync({
                base_version: '4_0_0',
                requestInfo,
                responseStreamer: null,
                bundle
            });

            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Person', base_version: '4_0_0' })
            );
            expect(mocks.databaseUpdateFactory.createDatabaseUpdateManager).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Person', base_version: '4_0_0' })
            );
        });

        test('searches for Person records linked to Patient and Person entries', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } },
                    { resource: { resourceType: 'Person', _uuid: 'uuid-per1', id: 'per1' } }
                ]
            });
            mocks.queryManager.findAsync.mockResolvedValue({
                toArrayAsync: jestObj.fn().mockResolvedValue([])
            });

            await manager.removeLinksFromOtherPersonsAsync({
                base_version: '4_0_0',
                requestInfo,
                responseStreamer: null,
                bundle
            });

            // Should be called twice: once for Patient, once for Person
            expect(mocks.queryManager.findAsync).toHaveBeenCalledTimes(2);
        });

        test('returns empty array when bundle has no entries', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            const bundle = new Bundle({ entry: null });

            // removeLinksToResourceTypeAsync checks bundle.entry and returns [] if null
            const result = await manager.removeLinksFromOtherPersonsAsync({
                base_version: '4_0_0',
                requestInfo,
                responseStreamer: null,
                bundle
            });

            expect(result).toEqual([]);
        });
    });

    describe('removeLinksToResourceTypeAsync', () => {
        test('finds person records with links to deleted resource uuids', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } },
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p2', id: 'p2' } }
                ]
            });

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn().mockResolvedValue({
                    toArrayAsync: jestObj.fn().mockResolvedValue([])
                })
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const mockDatabaseUpdateManagerForPerson = {
                replaceOneAsync: jestObj.fn().mockResolvedValue({})
            };
            Object.setPrototypeOf(mockDatabaseUpdateManagerForPerson,
                require('../../../dataLayer/databaseUpdateManager').DatabaseUpdateManager.prototype);

            await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                databaseUpdateManagerForPerson: mockDatabaseUpdateManagerForPerson,
                responseStreamer: null
            });

            expect(mockDatabaseQueryManagerForPerson.findAsync).toHaveBeenCalledWith({
                query: {
                    'link.target._uuid': {
                        $in: ['Patient/uuid-p1', 'Patient/uuid-p2']
                    }
                }
            });
        });

        test('removes links from person records and calls replaceOneAsync', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } }
                ]
            });

            const personRecord = {
                id: 'person-1',
                resourceType: 'Person',
                link: [
                    { target: { _uuid: 'Patient/uuid-p1', reference: 'Patient/p1' } },
                    { target: { _uuid: 'Patient/uuid-p99', reference: 'Patient/p99' } }
                ]
            };

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn().mockResolvedValue({
                    toArrayAsync: jestObj.fn().mockResolvedValue([personRecord])
                })
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const mockDatabaseUpdateManagerForPerson = {
                replaceOneAsync: jestObj.fn().mockResolvedValue({})
            };
            Object.setPrototypeOf(mockDatabaseUpdateManagerForPerson,
                require('../../../dataLayer/databaseUpdateManager').DatabaseUpdateManager.prototype);

            await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                databaseUpdateManagerForPerson: mockDatabaseUpdateManagerForPerson,
                responseStreamer: null
            });

            expect(mockDatabaseUpdateManagerForPerson.replaceOneAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    base_version: '4_0_0',
                    smartMerge: false
                })
            );
        });

        test('calls postSaveProcessor.afterSaveAsync for each updated person', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } }
                ]
            });

            const personRecord = {
                id: 'person-1',
                resourceType: 'Person',
                link: [
                    { target: { _uuid: 'Patient/uuid-p1', reference: 'Patient/p1' } }
                ]
            };

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn().mockResolvedValue({
                    toArrayAsync: jestObj.fn().mockResolvedValue([personRecord])
                })
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const mockDatabaseUpdateManagerForPerson = {
                replaceOneAsync: jestObj.fn().mockResolvedValue({})
            };
            Object.setPrototypeOf(mockDatabaseUpdateManagerForPerson,
                require('../../../dataLayer/databaseUpdateManager').DatabaseUpdateManager.prototype);

            await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                databaseUpdateManagerForPerson: mockDatabaseUpdateManagerForPerson,
                responseStreamer: null
            });

            expect(mocks.postSaveProcessor.afterSaveAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestId: 'req-1',
                    eventType: 'U',
                    resourceType: 'Person'
                })
            );
        });

        test('returns empty array when no resources of specified type in bundle', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Observation', _uuid: 'uuid-o1', id: 'o1' } }
                ]
            });

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn()
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const mockDatabaseUpdateManagerForPerson = {
                replaceOneAsync: jestObj.fn()
            };
            Object.setPrototypeOf(mockDatabaseUpdateManagerForPerson,
                require('../../../dataLayer/databaseUpdateManager').DatabaseUpdateManager.prototype);

            const result = await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                databaseUpdateManagerForPerson: mockDatabaseUpdateManagerForPerson,
                responseStreamer: null
            });

            expect(result).toEqual([]);
            expect(mockDatabaseQueryManagerForPerson.findAsync).not.toHaveBeenCalled();
        });

        test('streams BundleEntry to responseStreamer when provided', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = new Bundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } }
                ]
            });

            const personRecord = {
                id: 'person-1',
                resourceType: 'Person',
                link: [
                    { target: { _uuid: 'Patient/uuid-p1', reference: 'Patient/p1' } }
                ]
            };

            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn().mockResolvedValue({
                    toArrayAsync: jestObj.fn().mockResolvedValue([personRecord])
                })
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const mockDatabaseUpdateManagerForPerson = {
                replaceOneAsync: jestObj.fn().mockResolvedValue({})
            };
            Object.setPrototypeOf(mockDatabaseUpdateManagerForPerson,
                require('../../../dataLayer/databaseUpdateManager').DatabaseUpdateManager.prototype);

            const result = await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                databaseUpdateManagerForPerson: mockDatabaseUpdateManagerForPerson,
                responseStreamer
            });

            expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalled();
            // When streaming, entries are not returned in the array
            expect(result).toEqual([]);
        });

        test('returns empty array when bundle.entry is null', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = new Bundle({ entry: null });

            const mockDatabaseQueryManagerForPerson = { findAsync: jestObj.fn() };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const mockDatabaseUpdateManagerForPerson = { replaceOneAsync: jestObj.fn() };
            Object.setPrototypeOf(mockDatabaseUpdateManagerForPerson,
                require('../../../dataLayer/databaseUpdateManager').DatabaseUpdateManager.prototype);

            const result = await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                databaseUpdateManagerForPerson: mockDatabaseUpdateManagerForPerson,
                responseStreamer: null
            });

            expect(result).toEqual([]);
        });
    });
});
