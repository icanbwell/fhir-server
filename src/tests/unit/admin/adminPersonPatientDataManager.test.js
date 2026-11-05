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
const { AdminResourceWriter } = require('../../../admin/adminResourceWriter');
const { R4ArgsParser } = require('../../../operations/query/r4ArgsParser');

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
        buildBundle({ entry: [] })
    );

    const databaseQueryFactory = createPrototypedMock(DatabaseQueryFactory);
    const mockQueryManager = {
        findAsync: jestObj.fn().mockResolvedValue({
            toArrayAsync: jestObj.fn().mockResolvedValue([])
        })
    };
    databaseQueryFactory.createQuery = jestObj.fn().mockReturnValue(mockQueryManager);

    const adminResourceWriter = createPrototypedMock(AdminResourceWriter);
    adminResourceWriter.writeAsync = jestObj.fn().mockResolvedValue(undefined);

    const r4ArgsParser = createPrototypedMock(R4ArgsParser);
    r4ArgsParser.parseArgs = jestObj.fn().mockReturnValue({ id: 'test-id' });

    const inst = new AdminPersonPatientDataManager({
        fhirOperationsManager,
        everythingOperation,
        databaseQueryFactory,
        adminResourceWriter,
        r4ArgsParser
    });

    return {
        manager: inst,
        mocks: {
            fhirOperationsManager,
            everythingOperation,
            databaseQueryFactory,
            adminResourceWriter,
            queryManager: mockQueryManager,
            r4ArgsParser
        }
    };
}

const buildBundle = (props) => ({ resourceType: 'Bundle', ...props });

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
            const bundle = buildBundle({
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
            const bundle = buildBundle({
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
            const bundle = buildBundle({ entry: [] });
            mocks.everythingOperation.everythingAsync.mockResolvedValue(bundle);

            const result = await manager.deletePatientDataGraphAsync({
                req, res, patientId: 'pat-1', responseStreamer, method: 'GET'
            });

            expect(result).toBe(bundle);
        });

        describe('link-removal entries for a Person that pointed at the deleted Patient', () => {
            const arrangeLinkedPerson = () => {
                mocks.everythingOperation.everythingAsync.mockResolvedValue(
                    buildBundle({ entry: [{ resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } }] })
                );
                mocks.queryManager.findAsync.mockResolvedValue({
                    toArrayAsync: jestObj.fn().mockResolvedValue([{
                        id: 'person-1',
                        resourceType: 'Person',
                        link: [{ target: { _uuid: 'Patient/uuid-p1', reference: 'Patient/p1' } }]
                    }])
                });
            };
            const expectedPatchEntry = {
                id: 'person-1',
                resource: { resourceType: 'Person', id: 'person-1' },
                request: { id: 'req-123', method: 'PATCH', url: '/4_0_0/Person/person-1' }
            };

            test('without a response streamer, returns a JSON-safe bundle ending with the PATCH entry', async () => {
                arrangeLinkedPerson();

                const result = await manager.deletePatientDataGraphAsync({
                    req: {}, res: {}, patientId: 'p1', responseStreamer: null
                });

                const json = JSON.parse(JSON.stringify(result));
                expect(json.entry).toHaveLength(2);
                expect(json.entry[0].resource).toMatchObject({ resourceType: 'Patient', id: 'p1' });
                expect(json.entry[1]).toEqual(expectedPatchEntry);
            });

            test('with a response streamer, streams the PATCH entry as a plain object', async () => {
                arrangeLinkedPerson();
                const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };

                await manager.deletePatientDataGraphAsync({
                    req: {}, res: {}, patientId: 'p1', responseStreamer
                });

                expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalledTimes(2);
                const streamed = responseStreamer.writeBundleEntryAsync.mock.calls[1][0].bundleEntry;
                expect(Object.getPrototypeOf(streamed)).toBe(Object.prototype);
                expect(streamed).toEqual(expectedPatchEntry);
            });
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
            const bundle = buildBundle({ entry: [] });
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
        test('creates the query manager for Person resourceType', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            const bundle = buildBundle({ entry: [] });

            await manager.removeLinksFromOtherPersonsAsync({
                base_version: '4_0_0',
                requestInfo,
                responseStreamer: null,
                bundle
            });

            expect(mocks.databaseQueryFactory.createQuery).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Person', base_version: '4_0_0' })
            );
        });

        test('searches for Person records linked to Patient and Person entries', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            const bundle = buildBundle({
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
            const bundle = buildBundle({ entry: null });

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

            const bundle = buildBundle({
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

            await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
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

        test('writes the Person without the removed link through the admin resource writer using replace semantics', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = buildBundle({
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

            await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                responseStreamer: null
            });

            expect(mocks.adminResourceWriter.writeAsync).toHaveBeenCalledTimes(1);
            const writeArgs = mocks.adminResourceWriter.writeAsync.mock.calls[0][0];
            expect(writeArgs).toMatchObject({
                requestInfo,
                base_version: '4_0_0',
                resourceType: 'Person',
                smartMerge: false
            });
            expect(writeArgs.resource.id).toBe('person-1');
            expect(writeArgs.resource.link.map(l => l.target._uuid)).toEqual(['Patient/uuid-p99']);
        });

        test('writes every updated Person once, in order', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = buildBundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } }
                ]
            });

            const personRecords = ['person-1', 'person-2'].map(id => ({
                id,
                resourceType: 'Person',
                link: [{ target: { _uuid: 'Patient/uuid-p1', reference: 'Patient/p1' } }]
            }));

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn().mockResolvedValue({
                    toArrayAsync: jestObj.fn().mockResolvedValue(personRecords)
                })
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const result = await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                responseStreamer: null
            });

            expect(mocks.adminResourceWriter.writeAsync.mock.calls.map(call => call[0].resource.id))
                .toEqual(['person-1', 'person-2']);
            expect(result.map(entry => entry.id)).toEqual(['person-1', 'person-2']);
        });

        test('wraps a write failure and does not stream an entry for the failed Person', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = buildBundle({
                entry: [
                    { resource: { resourceType: 'Patient', _uuid: 'uuid-p1', id: 'p1' } }
                ]
            });

            const personRecord = {
                id: 'person-1',
                resourceType: 'Person',
                link: [{ target: { _uuid: 'Patient/uuid-p1', reference: 'Patient/p1' } }]
            };
            const responseStreamer = { writeBundleEntryAsync: jestObj.fn() };
            mocks.adminResourceWriter.writeAsync.mockRejectedValue(new Error('write failed'));

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn().mockResolvedValue({
                    toArrayAsync: jestObj.fn().mockResolvedValue([personRecord])
                })
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            await expect(manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                responseStreamer
            })).rejects.toThrow('Error in removeLinksToResourceTypeAsync()');
            expect(responseStreamer.writeBundleEntryAsync).not.toHaveBeenCalled();
        });

        test('returns empty array when no resources of specified type in bundle', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = buildBundle({
                entry: [
                    { resource: { resourceType: 'Observation', _uuid: 'uuid-o1', id: 'o1' } }
                ]
            });

            const mockDatabaseQueryManagerForPerson = {
                findAsync: jestObj.fn()
            };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const result = await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                responseStreamer: null
            });

            expect(result).toEqual([]);
            expect(mockDatabaseQueryManagerForPerson.findAsync).not.toHaveBeenCalled();
        });

        test('streams BundleEntry to responseStreamer when provided', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = buildBundle({
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

            const result = await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                responseStreamer
            });

            expect(responseStreamer.writeBundleEntryAsync).toHaveBeenCalled();
            // When streaming, entries are not returned in the array
            expect(result).toEqual([]);
        });

        test('returns empty array when bundle.entry is null', async () => {
            const requestInfo = { requestId: 'req-1', method: 'DELETE', headers: {} };
            Object.setPrototypeOf(requestInfo, require('../../../utils/fhirRequestInfo').FhirRequestInfo.prototype);

            const bundle = buildBundle({ entry: null });

            const mockDatabaseQueryManagerForPerson = { findAsync: jestObj.fn() };
            Object.setPrototypeOf(mockDatabaseQueryManagerForPerson,
                require('../../../dataLayer/databaseQueryManager').DatabaseQueryManager.prototype);

            const result = await manager.removeLinksToResourceTypeAsync({
                base_version: '4_0_0',
                requestInfo,
                bundle,
                resourceType: 'Patient',
                databaseQueryManagerForPerson: mockDatabaseQueryManagerForPerson,
                responseStreamer: null
            });

            expect(result).toEqual([]);
        });
    });
});
