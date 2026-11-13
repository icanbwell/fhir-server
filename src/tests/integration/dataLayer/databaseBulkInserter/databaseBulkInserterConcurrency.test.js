const { describe, beforeEach, afterEach, jest, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getTestRequestInfo } = require('../../common');
const { createTestContainer } = require('../../createTestContainer');
const { ChangeEventProducer } = require('../../../../utils/changeEventProducer');
const { generateUUIDv5 } = require('../../../../utils/uid.util');
const { FhirResourceWriteSerializer } = require('../../../../fhir/fhirResourceWriteSerializer');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');
const { buildBundleEntry } = require('../../../../utils/bundleEntryBuilder');
const deepcopy = require('deepcopy');

const identityExtensionUrls = [
    'https://www.icanbwell.com/sourceId',
    'https://www.icanbwell.com/uuid',
    'https://www.icanbwell.com/sourceAssigningAuthority'
];

const withoutIdentityExtensions = (value) => {
    if (Array.isArray(value)) {
        return value.map(withoutIdentityExtensions);
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .map(([key, child]) => [
                key,
                key === 'extension' && Array.isArray(child)
                    ? child.filter((e) => !identityExtensionUrls.includes(e.url))
                    : child
            ])
            .filter(([key, child]) => !(key === 'extension' && child.length === 0))
            .map(([key, child]) => [key, withoutIdentityExtensions(child)])
    );
};

const toWriteDoc = (resource) => FhirResourceWriteSerializer.serialize({ obj: deepcopy(resource) });

const toComparable = (doc) => {
    const copy = deepcopy(doc);
    copy.meta.lastUpdated = null;
    return withoutIdentityExtensions(FhirResourceSerializer.serialize(copy));
};

const toComparableHistoryEntry = (entry) => {
    const copy = deepcopy(entry);
    copy.resource.meta.lastUpdated = null;
    return withoutIdentityExtensions(buildBundleEntry(copy));
};


class MockChangeEventProducer extends ChangeEventProducer {
    /**
     * Constructor
     * @param {KafkaClient} kafkaClient
     * @param {ResourceManager} resourceManager
     * @param {string} fhirResourceChangeTopic
     * @param {RequestSpecificCache} requestSpecificCache
     * @param {ConfigManager} configManager
     */
    constructor ({
                    kafkaClient,
                    resourceManager,
                    fhirResourceChangeTopic,
                    requestSpecificCache,
                    configManager
                }) {
        super({
            kafkaClient,
            resourceManager,
            fhirResourceChangeTopic,
            requestSpecificCache,
            configManager
        });
    }
}

describe('databaseBulkInserter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        jest.restoreAllMocks();
    });

    afterEach(async () => {
        await commonAfterEach();
    });
    describe('databaseBulkInserter CodeSystem concurrency Tests', () => {
        const base_version = '4_0_0';
        test('execAsync works on CodeSystem without concurrency', async () => {
            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            fhirResourceChangeTopic: process.env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            /**
             * @type {FastDatabaseBulkInserter}
             */
            const databaseBulkInserter = container.fastDatabaseBulkInserter;
            const requestId = '1234';
            const userRequestId = '123456';
            const requestInfo = getTestRequestInfo({ requestId, userRequestId });

            const codeSystemOriginal = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '1'
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        }
                ]
            };

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const codeSystemCollection = fhirDb.collection(collectionName);

            await codeSystemCollection.insertOne(deepcopy(codeSystemOriginal));

            // add another one
            const codeSystem1 = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                _uuid: '93289a07-f21f-514b-9224-532b574c16cd',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '2',
                    security: [
                        {
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        },
                        {
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        }
                ]
            };
            const updateResult = await codeSystemCollection.findOneAndReplace(
                {
                    id: 'loinc-1'
                },
                deepcopy(codeSystem1),
                { includeResultMetadata: true }
            );
            expect(updateResult.lastErrorObject).toStrictEqual({
                n: 1,
                updatedExisting: true
            });
            const codeSystemsBeforeBulkUpdate = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystemsBeforeBulkUpdate.length).toStrictEqual(1);
            const expectedCodeSystemAfterFirstUpdate = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '2',
                    security: [
                        {
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        },
                        {
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        }
                ]
            };
            // noinspection JSCheckFunctionSignatures
            let actualCodeSystem = toComparable(codeSystemsBeforeBulkUpdate[0]);
            expect(actualCodeSystem).toStrictEqual(toComparable(expectedCodeSystemAfterFirstUpdate));

            const codeSystem2 = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        },
                    {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '3'
                                }
                            ]
                        }
                ]
            };
            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                id: codeSystem2.id,
                doc: toWriteDoc(codeSystem2),
                previousVersionId: '1'
            });

            const codeSystemHistoryEntriesBeforeMerge = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(codeSystemHistoryEntriesBeforeMerge.length).toStrictEqual(0);

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    created: false,
                    id: 'loinc-1',
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: true,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId, userRequestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // check codeSystems
            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    versionId: '3',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        },
                        {
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        },
                    {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '3'
                                }
                            ]
                        }
                ]
            };
            // noinspection JSCheckFunctionSignatures
            actualCodeSystem = toComparable(codeSystems[0]);

            expect(actualCodeSystem).toStrictEqual(toComparable(expectedCodeSystem));

            // now check the history table
            const actualCodeSystemHistoryEntries = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(actualCodeSystemHistoryEntries.length).toStrictEqual(1);
            const expectedCodeSystemHistoryEntry = {
                    id: generateUUIDv5('loinc-1|client'),
                    request: {
                        id: userRequestId,
                        method: 'POST',
                        url: '/4_0_0/CodeSystem/loinc-1'
                    },
                    resource: { resourceType: 'CodeSystem',
                        id: 'loinc-1',
                        _uuid: '93289a07-f21f-514b-9224-532b574c16cd',
                        status: 'active',
                        content: 'complete',
                        meta: {
                            versionId: '3',
                            source: 'http://www/icanbwell.com',
                            security: [
                                {
                                    id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                                    system: 'https://www.icanbwell.com/owner',
                                    code: 'client'
                                },
                                {
                                    code: 'client',
                                    id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                                    system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                                }
                            ]
                        },
                        concept: [
                            {
                                    id: '3565-4',
                                    code: '3565-4',
                                    property: [
                                        {
                                            code: 'medline_plus',
                                            valueString: '1'
                                        }
                                    ]
                                },
                            {
                                    id: '5565-4',
                                    code: '5565-4',
                                    property: [
                                        {
                                            code: 'medline_plus',
                                            valueString: '2'
                                        }
                                    ]
                                },
                            {
                                    id: '6665-3',
                                    code: '6665-3',
                                    property: [
                                        {
                                            code: 'medline_plus',
                                            valueString: '3'
                                        }
                                    ]
                                }
                        ]
                    }
                };
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystemHistoryEntry = toComparableHistoryEntry(actualCodeSystemHistoryEntries[0]);
            expect(actualCodeSystemHistoryEntry).toStrictEqual(toComparableHistoryEntry(expectedCodeSystemHistoryEntry));
        });
        test('execAsync works on CodeSystem with concurrency', async () => {
            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            fhirResourceChangeTopic: process.env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            /**
             * @type {FastDatabaseBulkInserter}
             */
            const databaseBulkInserter = container.fastDatabaseBulkInserter;
            const requestId = '1234';
            const userRequestId = '123456';
            const requestInfo = getTestRequestInfo({ requestId, userRequestId });

            const codeSystemOriginal = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                                system: 'https://www.icanbwell.com/owner',
                                code: 'client'
                            }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        }
                ]
            };

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const codeSystemCollection = fhirDb.collection(collectionName);

            await codeSystemCollection.insertOne(deepcopy(codeSystemOriginal));

            const codeSystem2 = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }
                    ]
                },
                concept: [
                    {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '3'
                                }
                            ]
                        }
                ]
            };
            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                id: codeSystem2.id,
                doc: toWriteDoc(codeSystem2),
                previousVersionId: '1'
            });

            // now add in a new one while waiting
            const codeSystem1 = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        },
                        {
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        }
                ]
            };
            const updateResult = await codeSystemCollection.findOneAndReplace(
                { id: 'loinc-1' },
                deepcopy(codeSystem1),
                { includeResultMetadata: true }
            );
            expect(updateResult.lastErrorObject).toStrictEqual({
                n: 1,
                updatedExisting: true
            });
            const codeSystemsBeforeBulkUpdate = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystemsBeforeBulkUpdate.length).toStrictEqual(1);

            const codeSystemHistoryEntriesBeforeUpdate = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(codeSystemHistoryEntriesBeforeUpdate.length).toStrictEqual(0);

            const expectedCodeSystemAfterFirstUpdate = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                _uuid: generateUUIDv5('loinc-1|client'),
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '2',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        },
                        {
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        }
                ]
            };
            // noinspection JSCheckFunctionSignatures
            let actualCodeSystem = toComparable(codeSystemsBeforeBulkUpdate[0]);
            expect(actualCodeSystem).toStrictEqual(toComparable(expectedCodeSystemAfterFirstUpdate));

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    id: 'loinc-1',
                    created: false,
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: true,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId, userRequestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            // check codeSystems
            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = { resourceType: 'CodeSystem',
                _uuid: generateUUIDv5('loinc-1|client'),
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    versionId: '3',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        },
                        {
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        },
                    {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '3'
                                }
                            ]
                        }
                ]
            };
            // noinspection JSCheckFunctionSignatures
            actualCodeSystem = toComparable(codeSystems[0]);

            expect(actualCodeSystem).toStrictEqual(toComparable(expectedCodeSystem));

            // now check the history table
            const actualCodeSystemHistoryEntries = await fhirDb.collection(`${collectionName}_History`).find().toArray();
            expect(actualCodeSystemHistoryEntries.length).toStrictEqual(1);
            const expectedCodeSystemHistoryEntry = {
                    id: generateUUIDv5('loinc-1|client'),
                    request: {
                        id: userRequestId,
                        method: 'POST',
                        url: '/4_0_0/CodeSystem/loinc-1'
                    },
                    resource: { resourceType: 'CodeSystem',
                        id: 'loinc-1',
                        _uuid: generateUUIDv5('loinc-1|client'),
                        status: 'active',
                        content: 'complete',
                        meta: {
                            versionId: '3',
                            source: 'http://www/icanbwell.com',
                            security: [
                                {
                                    system: 'https://www.icanbwell.com/owner',
                                    id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                                    code: 'client'
                                },
                                {
                                    code: 'client',
                                    id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                                    system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                                }
                            ]
                        },
                        concept: [
                            {
                                    id: '3565-4',
                                    code: '3565-4',
                                    property: [
                                        {
                                            code: 'medline_plus',
                                            valueString: '1'
                                        }
                                    ]
                                },
                            {
                                    id: '5565-4',
                                    code: '5565-4',
                                    property: [
                                        {
                                            code: 'medline_plus',
                                            valueString: '2'
                                        }
                                    ]
                                },
                            {
                                    id: '6665-3',
                                    code: '6665-3',
                                    property: [
                                        {
                                            code: 'medline_plus',
                                            valueString: '3'
                                        }
                                    ]
                                }
                        ]
                    }
                };
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystemHistoryEntry = toComparableHistoryEntry(actualCodeSystemHistoryEntries[0]);
            expect(actualCodeSystemHistoryEntry).toStrictEqual(toComparableHistoryEntry(expectedCodeSystemHistoryEntry));
        });
        test('execAsync works on CodeSystem with multiple inserts and replace on same id', async () => {
            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            fhirResourceChangeTopic: process.env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            /**
             * @type {FastDatabaseBulkInserter}
             */
            const databaseBulkInserter = container.fastDatabaseBulkInserter;
            const requestId = '1234';

            const codeSystemOriginal = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        }
                ]
            };

            // now add in a new one while waiting
            const codeSystem1 = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }
                    ]
                },
                concept: [
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        }
                ]
            };

            const codeSystem2 = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }
                    ]
                },
                concept: [
                    {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '3'
                                }
                            ]
                        }
                ]
            };
            const requestInfo = getTestRequestInfo({ requestId });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(codeSystemOriginal)
            });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(codeSystem1)
            });

            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(codeSystem2),
                previousVersionId: null
            });

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    created: true,
                    id: 'loinc-1',
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: false,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';

            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                            code: 'client'
                        },
                        {
                            code: 'client',
                            id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                            system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        },
                    {
                            id: '5565-4',
                            code: '5565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '2'
                                }
                            ]
                        },
                    {
                            id: '6665-3',
                            code: '6665-3',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '3'
                                }
                            ]
                        }
                ]
            };
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystem = toComparable(codeSystems[0]);

            expect(actualCodeSystem).toStrictEqual(toComparable(expectedCodeSystem));
        });
        test('execAsync works on CodeSystem with multiple inserts with same resource', async () => {
            const container = createTestContainer((container1) => {
                container1.register(
                    'changeEventProducer',
                    (c) =>
                        new MockChangeEventProducer({
                            kafkaClient: c.kafkaClient,
                            resourceManager: c.resourceManager,
                            fhirResourceChangeTopic: process.env.KAFKA_RESOURCE_CHANGE_TOPIC || 'business.events',
                            configManager: c.configManager,
                            requestSpecificCache: c.requestSpecificCache
                        })
                );
                return container1;
            });

            /**
             * @type {FastDatabaseBulkInserter}
             */
            const databaseBulkInserter = container.fastDatabaseBulkInserter;
            const requestId = '1234';
            const requestInfo = getTestRequestInfo({ requestId });

            const codeSystemOriginal = { resourceType: 'CodeSystem',
                id: 'loinc-1',
                status: 'active',
                content: 'complete',
                meta: {
                    lastUpdated: Date(),
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                            system: 'https://www.icanbwell.com/owner',
                            code: 'client'
                        }
                    ]
                },
                concept: [
                    {
                            id: '3565-4',
                            code: '3565-4',
                            property: [
                                {
                                    code: 'medline_plus',
                                    valueString: '1'
                                }
                            ]
                        }
                ]
            };

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(codeSystemOriginal)
            });

            await databaseBulkInserter.insertOneAsync({
                base_version,
                requestInfo,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(codeSystemOriginal)
            });

            await databaseBulkInserter.mergeOneAsync({
                base_version,
                requestInfo,
                id: codeSystemOriginal.id,
                resourceType: 'CodeSystem',
                doc: toWriteDoc(codeSystemOriginal),
                previousVersionId: null
            });

            // now execute the bulk inserts
            /**
             * @type {MergeResultEntry[]}
             */
            const mergeResults = await databaseBulkInserter.executeAsync({
                requestInfo,
                base_version
            });
            expect(mergeResults.map(m => m.toJSON())).toStrictEqual([
                {
                    created: true,
                    id: 'loinc-1',
                    resourceType: 'CodeSystem',
                    sourceAssigningAuthority: 'client',
                    updated: false,
                    uuid: '93289a07-f21f-514b-9224-532b574c16cd'
                }
            ]);
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'CodeSystem_4_0_0';

            const codeSystems = await fhirDb.collection(collectionName).find().toArray();
            expect(codeSystems.length).toStrictEqual(1);
            const expectedCodeSystem = { resourceType: 'CodeSystem',
                concept: [
                    {
                        code: '3565-4',
                        id: '3565-4',
                        property: [
                            {
                                code: 'medline_plus',
                                valueString: '1'
                            }
                        ]
                    }
                ],
                content: 'complete',
                id: 'loinc-1',
                meta: {
                    versionId: '1',
                    source: 'http://www/icanbwell.com',
                    security: [
                        {
                                system: 'https://www.icanbwell.com/owner',
                                id: "1642e685-6de9-5bdb-89e8-b62ffe4420eb",
                                code: 'client'
                            },
                        {
                                code: 'client',
                                id: "cea955c4-9b2c-5b0d-8b48-acfd40cabb59",
                                system: 'https://www.icanbwell.com/sourceAssigningAuthority'
                            }
                    ]
                },
                status: 'active'
            };
            // noinspection JSCheckFunctionSignatures
            const actualCodeSystem = toComparable(codeSystems[0]);

            expect(actualCodeSystem).toStrictEqual(toComparable(expectedCodeSystem));
        });
    });
});
