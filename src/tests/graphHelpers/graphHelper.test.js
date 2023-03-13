const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../common');
const graphSimpleReverseDefinition = require('./fixtures/graphSimpleReverse.json');
const graphSimpleForwardDefinition = require('./fixtures/graphSimpleForward.json');
const graphDefinition = require('./fixtures/graph.json');
const graphWithExtensionDefinition = require('./fixtures/graphWithExtension.json');
const graphSimpleWithExtensionDefinition = require('./fixtures/graphSimpleWithExtension.json');
const {FhirRequestInfo} = require('../../utils/fhirRequestInfo');
const {createTestContainer} = require('../createTestContainer');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');
const {generateUUIDv5} = require('../../utils/uid.util');

/**
 * Gets graph helper
 * @return {GraphHelper}
 */
function getGraphHelper() {
    const container = createTestContainer();
    return container.graphHelper;
}

describe('graphHelper Tests', () => {
    const base_version = '4_0_0';
    const uuid1 = generateUUIDv5('1|medstar');
    const uuid2 = generateUUIDv5('2|medstar');
    const uuid20 = generateUUIDv5('20|medstar');
    const uuid10 = generateUUIDv5('10|medstar');
    const uuid100 = generateUUIDv5('100|medstar');
    const uuid200 = generateUUIDv5('200|medstar');
    const uuid2000 = generateUUIDv5('2000|medstar');
    const uuidAetna = generateUUIDv5('AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He|medstar');

    beforeEach(async () => {
        await commonBeforeEach();
        await createTestRequest();
        /**
         * @type {SimpleContainer}
         */
        const container = getTestContainer();
        /**
         * @type {MongoDatabaseManager}
         */
        const mongoDatabaseManager = container.mongoDatabaseManager;
        let db = await mongoDatabaseManager.getClientDbAsync();
        const resourceType = 'Practitioner';
        /**
         * @type {import('mongodb').Collection<import('mongodb').Document>}
         */
        const collection = db.collection(`${resourceType}_${base_version}`);

        await collection.insertOne({
                id: '1',
                _sourceId: '1',
                _uuid: uuid1,
                resourceType: 'Practitioner'
            }
        );
        // const doc = await collection.findOne({id: '1'});
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const requestInfo = new FhirRequestInfo({
        user: 'user',
        scope: 'user/*.read access/*.*',
        requestId: '1',
        protocol: 'https',
        originalUrl: '',
        host: 'host',
        headers: {},
        method: 'post',
        contentTypeFromHeader: null
    });

    describe('graphHelper Tests with uuid', () => {
        test('graphHelper single Practitioner works', async () => {
            const resourceType = 'Practitioner';
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync(
                {
                    requestInfo,
                    base_version,
                    resourceType,
                    graphDefinitionJson: graphSimpleReverseDefinition,
                    contained: false,
                    parsedArgs: parsedArgs
                }
            );
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper multiple Practitioners works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            const resourceType = 'Practitioner';
            const collection = db.collection(`${resourceType}_${base_version}`);

            await collection.insertOne({
                    id: '2',
                    _sourceId: '2',
                    _uuid: uuid2,
                    resourceType: 'Practitioner'
                }
            );
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1,2'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '2',
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper simple single Practitioner with 1 level reverse nesting works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'PractitionerRole';
            const collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
            });

            const cursor = await collection.find({
                'practitioner._uuid': 'Practitioner/18ba3527-77e0-5ae6-a872-181654110d28'
            });
            const doc = await cursor.next();
            delete doc._id;
            expect(doc).toStrictEqual({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '10',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/10',
                        resource: {
                            id: '10',
                            practitioner: {
                                reference: 'Practitioner/1',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper single Practitioner with 1 level reverse nesting works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'PractitionerRole';
            const collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '10',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/10',
                        resource: {
                            id: '10',
                            practitioner: {
                                reference: 'Practitioner/1',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper simple single Practitioner with 1 level nesting and contained works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'PractitionerRole';
            const collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: true,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            contained: [
                                {
                                    id: '10',
                                    practitioner: {
                                        reference: 'Practitioner/1',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper single Practitioner with 1 level nesting and contained works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'PractitionerRole';
            const collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphDefinition,
                contained: true,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            contained: [
                                {

                                    id: '10',
                                    practitioner: {
                                        reference: 'Practitioner/1',
                                    },
                                    resourceType: 'PractitionerRole',
                                }
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper simple single Practitioner with 1 level forward nesting works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            // add a PractitionerRole
            let resourceType = 'PractitionerRole';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _uuid: `Organization/${uuid100}`
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );

            resourceType = 'PractitionerRole';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '10'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphSimpleForwardDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '10',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/10',
                        resource: {
                            id: '10',
                            organization: {
                                reference: 'Organization/100',
                            },
                            practitioner: {
                                reference: 'Practitioner/1',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                    {
                        id: '100',
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper single Practitioner with 1 level nesting and contained and hash_references works', async () => {
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'PractitionerRole';
            const collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1', '_hash_references': 1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: true,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            contained: [
                                {
                                    id: '10',
                                    practitioner: {
                                        reference: 'Practitioner/#1',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper single Practitioner with 2 level nesting works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            // add a PractitionerRole
            let resourceType = 'PractitionerRole';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _sourceId: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '10',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/10',
                        resource: {
                            id: '10',
                            organization: {
                                reference: 'Organization/100',
                            },
                            practitioner: {
                                reference: 'Practitioner/1',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                    {
                        id: '100',
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper multiple Practitioners with 2 level nesting works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'Practitioner';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '2',
                    _sourceId: '2',
                    _uuid: uuid2,
                    resourceType: 'Practitioner'
                }
            );

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _sourceId: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`,
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`,
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );
            await collection.insertOne({
                id: '200',
                _sourceId: '200',
                _uuid: uuid200,
                resourceType: resourceType
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1,2'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '2',
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '10',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/10',
                        resource: {
                            id: '10',
                            organization: {
                                reference: 'Organization/100',
                            },
                            practitioner: {
                                reference: 'Practitioner/1',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                    {
                        id: '100',
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                    {
                        id: '20',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/20',
                        resource: {
                            id: '20',
                            organization: {
                                reference: 'Organization/200',
                            },
                            practitioner: {
                                reference: 'Practitioner/2',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                    {
                        id: '200',
                        fullUrl: 'https://host/4_0_0/Organization/200',
                        resource: {
                            id: '200',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper multiple Practitioners with 2 level nesting and contained works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'Practitioner';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '2',
                    _sourceId: '2',
                    _uuid: uuid2,
                    resourceType: 'Practitioner'
                }
            );

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _sourceId: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`,
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`,
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );
            await collection.insertOne({
                    id: '200',
                    _sourceId: '200',
                    _uuid: uuid200,
                    resourceType: resourceType
                }
            );

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1,2'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphDefinition,
                contained: true,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            contained: [
                                {
                                    id: '10',
                                    organization: {
                                        reference: 'Organization/100',
                                    },
                                    practitioner: {
                                        reference: 'Practitioner/1',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                                {
                                    id: '100',
                                    resourceType: 'Organization',
                                },
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '2',
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            contained: [
                                {
                                    id: '20',
                                    organization: {
                                        reference: 'Organization/200',
                                    },
                                    practitioner: {
                                        reference: 'Practitioner/2',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                                {
                                    id: '200',
                                    resourceType: 'Organization',
                                },
                            ],
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper simple single Practitioner with 1 level nesting and extension works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            // add a PractitionerRole
            let resourceType = 'PractitionerRole';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`,
                },
                organization: {
                    reference: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://medstarhealth.org/IDHP',
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123,
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _sourceId: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _uuid: uuidAetna,
                resourceType: resourceType,
            });

            resourceType = 'PractitionerRole';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '10'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphSimpleWithExtensionDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '10',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/10',
                        resource: {
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'for_system',
                                            valueUri: 'http://medstarhealth.org/IDHP',
                                        },
                                        {
                                            url: 'availability_score',
                                            valueDecimal: 0.1234567890123,
                                        },
                                    ],
                                    id: 'IDHP',
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                                },
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference:
                                                    'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'
                                            },
                                        },
                                    ],
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                                },
                            ],
                            id: '10',
                            organization: {
                                reference: 'Organization/100',
                            },
                            practitioner: {
                                reference: 'Practitioner/1',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                    {
                        id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                        fullUrl:
                            'https://host/4_0_0/InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                        resource: {
                            id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                            resourceType: 'InsurancePlan',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper multiple Practitioners with 2 level nesting and extension works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'Practitioner';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '2',
                _sourceId: '2',
                _uuid: uuid2,
                resourceType: 'Practitioner',
                extension: [
                    {
                        extension: {
                            url: 'plan',
                            valueReference: {
                                reference: 'InsurancePlan/2000',
                                _uuid: `InsurancePlan/${uuid2000}`
                            },
                        },
                    },
                ],
            });

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _sourceId: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://medstarhealth.org/IDHP',
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123,
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`,
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`,
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );
            await collection.insertOne({
                    id: '200',
                    _sourceId: '200',
                    _uuid: uuid200,
                    resourceType: resourceType
                }
            );

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _sourceId: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _uuid: uuidAetna,
                resourceType: resourceType,
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1,2'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: false,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '2',
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: 'InsurancePlan/2000',
                                            },
                                        },
                                    ],
                                },
                            ],
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '10',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/10',
                        resource: {
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'for_system',
                                            valueUri: 'http://medstarhealth.org/IDHP',
                                        },
                                        {
                                            url: 'availability_score',
                                            valueDecimal: 0.1234567890123,
                                        },
                                    ],
                                    id: 'IDHP',
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                                },
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: 'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'
                                            },
                                        },
                                    ],
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                                },
                            ],
                            id: '10',
                            organization: {
                                reference: 'Organization/100',
                            },
                            practitioner: {
                                reference: 'Practitioner/1',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                    {
                        id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                        fullUrl:
                            'https://host/4_0_0/InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                        resource: {
                            id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                            resourceType: 'InsurancePlan',
                        },
                    },
                    {
                        id: '100',
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                    {
                        id: '20',
                        fullUrl: 'https://host/4_0_0/PractitionerRole/20',
                        resource: {
                            id: '20',
                            organization: {
                                reference: 'Organization/200',
                            },
                            practitioner: {
                                reference: 'Practitioner/2',
                            },
                            resourceType: 'PractitionerRole',
                        },
                    },
                    {
                        id: '200',
                        fullUrl: 'https://host/4_0_0/Organization/200',
                        resource: {
                            id: '200',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper multiple Practitioners with 2 level nesting and extension and contained works', async () => {

            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'Practitioner';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '2',
                _sourceId: '2',
                _uuid: uuid2,
                resourceType: 'Practitioner',
                extension: [
                    {
                        extension: {
                            url: 'plan',
                            valueReference: {
                                reference: 'InsurancePlan/2000',
                            },
                        },
                    },
                ],
            });

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _sourceId: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://medstarhealth.org/IDHP',
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123,
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`,
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`,
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );
            await collection.insertOne({
                    id: '200',
                    _sourceId: '200',
                    _uuid: uuid200,
                    resourceType: resourceType
                }
            );

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _sourceId: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _uuid: uuidAetna,
                resourceType: resourceType,
            });
            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': '1,2'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: true,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            contained: [
                                {
                                    extension: [
                                        {
                                            extension: [
                                                {
                                                    url: 'for_system',
                                                    valueUri: 'http://medstarhealth.org/IDHP',
                                                },
                                                {
                                                    url: 'availability_score',
                                                    valueDecimal: 0.1234567890123,
                                                },
                                            ],
                                            id: 'IDHP',
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                                        },
                                        {
                                            extension: [
                                                {
                                                    url: 'plan',
                                                    valueReference: {
                                                        reference: 'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'
                                                    },
                                                },
                                            ],
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                                        },
                                    ],
                                    id: '10',
                                    organization: {
                                        reference: 'Organization/100',
                                    },
                                    practitioner: {
                                        reference: 'Practitioner/1',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                                {
                                    id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    resourceType: 'InsurancePlan',
                                },
                                {
                                    id: '100',
                                    resourceType: 'Organization',
                                },
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '2',
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            contained: [
                                {
                                    id: '20',
                                    organization: {
                                        reference: 'Organization/200',
                                    },
                                    practitioner: {
                                        reference: 'Practitioner/2',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                                {
                                    id: '200',
                                    resourceType: 'Organization',
                                },
                            ],
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: 'InsurancePlan/2000',
                                            },
                                        },
                                    ],
                                },
                            ],
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper multiple Practitioners with 2 level nesting and extension and contained works with debug', async () => {
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'Practitioner';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '2',
                _sourceId: '2',
                _uuid: uuid2,
                resourceType: 'Practitioner',
                extension: [
                    {
                        extension: {
                            url: 'plan',
                            valueReference: {
                                reference: 'InsurancePlan/2000',
                            },
                        },
                    },
                ],
            });

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _sourceId: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://medstarhealth.org/IDHP',
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123,
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`,
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`,
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );
            await collection.insertOne({
                    id: '200',
                    _sourceId: '200',
                    _uuid: uuid200,
                    resourceType: resourceType
                }
            );

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _sourceId: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _uuid: uuidAetna,
                resourceType: resourceType,
            });
            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', _debug: 1, 'id': '1,2'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args: args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: true,
                args: args,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.meta).toBeDefined();
            expect(result.meta.tag).toBeDefined();
            expect(result.meta.tag.filter(t => t.system === 'https://www.icanbwell.com/queryExplain').length).toBe(1);
            for (const tag of result.meta.tag) {
                if (tag.system === 'https://www.icanbwell.com/queryExplain') {
                    delete tag['display'];
                }
                if (tag.system === 'https://www.icanbwell.com/queryExplainSimple') {
                    delete tag['display'];
                }
                if (tag.system === 'https://www.icanbwell.com/queryTime') {
                    delete tag['display'];
                }
            }
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        id: '1',
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            contained: [
                                {
                                    extension: [
                                        {
                                            extension: [
                                                {
                                                    url: 'for_system',
                                                    valueUri: 'http://medstarhealth.org/IDHP',
                                                },
                                                {
                                                    url: 'availability_score',
                                                    valueDecimal: 0.1234567890123,
                                                },
                                            ],
                                            id: 'IDHP',
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                                        },
                                        {
                                            extension: [
                                                {
                                                    url: 'plan',
                                                    valueReference: {
                                                        reference: 'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'
                                                    },
                                                },
                                            ],
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                                        },
                                    ],
                                    id: '10',
                                    organization: {
                                        reference: 'Organization/100',
                                    },
                                    practitioner: {
                                        reference: 'Practitioner/1',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                                {
                                    id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    resourceType: 'InsurancePlan',
                                },
                                {
                                    id: '100',
                                    resourceType: 'Organization',
                                },
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        id: '2',
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            contained: [
                                {
                                    id: '20',
                                    organization: {
                                        reference: 'Organization/200',
                                    },
                                    practitioner: {
                                        reference: 'Practitioner/2',
                                    },
                                    resourceType: 'PractitionerRole',
                                },
                                {
                                    id: '200',
                                    resourceType: 'Organization',
                                },
                            ],
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: 'InsurancePlan/2000',
                                            },
                                        },
                                    ],
                                },
                            ],
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                'meta': {
                    'tag': [
                        {
                            'display': "db.Practitioner_4_0_0.find({'_sourceId':{'$in':['1','2']}}, {'_id':0})  | db.PractitionerRole_4_0_0.find({'$or':[{'practitioner._uuid':{'$in':['Practitioner/18ba3527-77e0-5ae6-a872-181654110d28','Practitioner/034ef9e0-007c-54a7-a0be-a06db20b9ea9']}},{'practitioner._sourceId':{'$in':['Practitioner/1','Practitioner/2']}}]}, {}) | db.Organization_4_0_0.find({'$or':[{'_uuid':'5a1d6b34-dbdc-5974-9816-53a13b80c839'},{'_sourceId':'100'},{'_uuid':'2cab0141-cb78-5ca1-8673-8c7bcdcf524d'},{'_sourceId':'200'}]}, {}) | db.InsurancePlan_4_0_0.find({'$or':[{'_uuid':'24c117ef-4601-52ea-8812-ac66793956b5'},{'_sourceId':'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'}]}, {})",
                            'system': 'https://www.icanbwell.com/query'
                        },
                        {
                            'code': 'Practitioner_4_0_0|PractitionerRole_4_0_0|Organization_4_0_0|InsurancePlan_4_0_0',
                            'system': 'https://www.icanbwell.com/queryCollection'
                        },
                        {
                            'display': '[{\'projection\':{\'_id\':0}}]',
                            'system': 'https://www.icanbwell.com/queryOptions'
                        },
                        {
                            'display': '[]',
                            'system': 'https://www.icanbwell.com/queryFields'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryTime'
                        },
                        {
                            'display': '{\'useTwoStepSearchOptimization\':undefined}',
                            'system': 'https://www.icanbwell.com/queryOptimization'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryExplain'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryExplainSimple'
                        }
                    ]
                },

                id: '1',
                resourceType: 'Bundle',
                type: 'searchset',
            });
        });
        test('graphHelper multiple Practitioners with 2 level nesting and extension and contained works with explain', async () => {
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            const db = await mongoDatabaseManager.getClientDbAsync();
            let resourceType = 'Practitioner';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '2',
                _sourceId: '2',
                _uuid: uuid2,
                resourceType: 'Practitioner',
                extension: [
                    {
                        extension: {
                            url: 'plan',
                            valueReference: {
                                reference: 'InsurancePlan/2000',
                                _uuid: `InsurancePlan/${uuid2000}`,
                            },
                        },
                    },
                ],
            });

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                _sourceId: '10',
                _uuid: uuid10,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                    _sourceId: 'Practitioner/1',
                    _uuid: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: 'Organization/100',
                    _sourceId: 'Organization/100',
                    _uuid: `Organization/${uuid100}`,
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://medstarhealth.org/IDHP',
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123,
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search',
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`,
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`,
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                    id: '100',
                    _sourceId: '100',
                    _uuid: uuid100,
                    resourceType: resourceType
                }
            );
            await collection.insertOne({
                    id: '200',
                    _sourceId: '200',
                    _uuid: uuid200,
                    resourceType: resourceType
                }
            );

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _sourceId: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _uuid: uuidAetna,
                resourceType: resourceType,
            });
            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', _explain: 1, 'id': '1,2'};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                resourceType,
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: true,
                parsedArgs: parsedArgs
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.meta).toBeDefined();
            expect(result.meta.tag).toBeDefined();
            expect(result.meta.tag.filter(t => t.system === 'https://www.icanbwell.com/queryExplain').length).toBe(1);
            for (const tag of result.meta.tag) {
                if (tag.system === 'https://www.icanbwell.com/queryExplain') {
                    delete tag['display'];
                }
                if (tag.system === 'https://www.icanbwell.com/queryExplainSimple') {
                    delete tag['display'];
                }
                if (tag.system === 'https://www.icanbwell.com/queryTime') {
                    delete tag['display'];
                }
            }
            expect(result.toJSON()).toStrictEqual({
                'resourceType': 'Bundle',
                'id': '1',
                'meta': {
                    'tag': [
                        {
                            'system': 'https://www.icanbwell.com/query',
                            'display': "db.Practitioner_4_0_0.find({'_sourceId':{'$in':['1','2']}}, {'_id':0})  | db.PractitionerRole_4_0_0.find({'$or':[{'practitioner._uuid':'Practitioner/18ba3527-77e0-5ae6-a872-181654110d28'},{'practitioner._sourceId':'Practitioner/1'}]}, {}) | db.Organization_4_0_0.find({'$or':[{'_uuid':'5a1d6b34-dbdc-5974-9816-53a13b80c839'},{'_sourceId':'100'}]}, {}) | db.InsurancePlan_4_0_0.find({'$or':[{'_uuid':'24c117ef-4601-52ea-8812-ac66793956b5'},{'_sourceId':'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'}]}, {})",
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryCollection',
                            'code': 'Practitioner_4_0_0|PractitionerRole_4_0_0|Organization_4_0_0|InsurancePlan_4_0_0',
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryOptions',
                            'display': '[{\'projection\':{\'_id\':0}}]'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryFields',
                            'display': '[]'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryTime',
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryOptimization',
                            'display': '{\'useTwoStepSearchOptimization\':undefined}'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryExplain',
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryExplainSimple'
                        }
                    ]
                },
                'type': 'searchset',
                'entry': [
                    {
                        'id': '1',
                        'fullUrl': 'https://host/4_0_0/Practitioner/1',
                        'resource': {
                            'resourceType': 'Practitioner',
                            'id': '1',
                            'contained': [
                                {
                                    'resourceType': 'PractitionerRole',
                                    'id': '10',
                                    'extension': [
                                        {
                                            'id': 'IDHP',
                                            'extension': [
                                                {
                                                    'url': 'for_system',
                                                    'valueUri': 'http://medstarhealth.org/IDHP'
                                                },
                                                {
                                                    'url': 'availability_score',
                                                    'valueDecimal': 0.1234567890123
                                                }
                                            ],
                                            'url': 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                                        },
                                        {
                                            'extension': [
                                                {
                                                    'url': 'plan',
                                                    'valueReference': {
                                                        'reference': 'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'
                                                    }
                                                }
                                            ],
                                            'url': 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                                        }
                                    ],
                                    'practitioner': {
                                        'reference': 'Practitioner/1',
                                    },
                                    'organization': {
                                        'reference': 'Organization/100',
                                    }
                                },
                                {
                                    'resourceType': 'InsurancePlan',
                                    'id': 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'
                                },
                                {
                                    'resourceType': 'Organization',
                                    'id': '100'
                                },
                            ]
                        }
                    }
                ]
            });
        });
    });
});
