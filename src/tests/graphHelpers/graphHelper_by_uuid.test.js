const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../common');
const graphSimpleReverseDefinition = require('./fixtures/graphSimpleReverse.json');
const graphSimpleForwardDefinition = require('./fixtures/graphSimpleForward.json');
const graphDefinition = require('./fixtures/graph.json');
const graphWithExtensionDefinition = require('./fixtures/graphWithExtension.json');
const graphSimpleWithExtensionDefinition = require('./fixtures/graphSimpleWithExtension.json');
const {FhirRequestInfo} = require('../../utils/fhirRequestInfo');
const {createTestContainer} = require('../createTestContainer');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {generateUUIDv5} = require('../../utils/uid.util');

/**
 * Gets graph helper
 * @return {GraphHelper}
 */
function getGraphHelper () {
    const container = createTestContainer();
    return container.graphHelper;
}

describe('graphHelper Tests', () => {
    const base_version = '4_0_0';
    const uuid1 = generateUUIDv5('1|client');
    const uuid2 = generateUUIDv5('2|client');
    const uuid20 = generateUUIDv5('20|client');
    const uuid10 = generateUUIDv5('10|client');
    const uuid100 = generateUUIDv5('100|client');
    const uuid200 = generateUUIDv5('200|client');
    const uuid2000 = generateUUIDv5('2000|client');
    const uuidAetna = generateUUIDv5('AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He|client');

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
        const db = await mongoDatabaseManager.getClientDbAsync();
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
        requestId: '12345678',
        userRequestId: '1',
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
            const args = {'base_version': '4_0_0', 'id': uuid1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
            const args = {'base_version': '4_0_0', 'id': `${uuid1},${uuid2}`};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid2,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid2}`,
                        resource: {
                            id: uuid2,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                }
            });

            const cursor = await collection.find({
                'practitioner._uuid': 'Practitioner/c87b8e53-b3db-53a0-aa92-05f4a3fb9d15'
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
                }
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': uuid1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid10,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid10}`,
                        resource: {
                            id: uuid10,
                            practitioner: {
                                reference: `Practitioner/${uuid1}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                }
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': uuid1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid10,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid10}`,
                        resource: {
                            id: uuid10,
                            practitioner: {
                                reference: `Practitioner/${uuid1}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                }
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': uuid1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            contained: [
                                {
                                    id: uuid10,
                                    practitioner: {
                                        reference: `Practitioner/${uuid1}`
                                    },
                                    resourceType: 'PractitionerRole'
                                }
                            ],
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                }
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': uuid1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            contained: [
                                {

                                    id: uuid10,
                                    practitioner: {
                                        reference: `Practitioner/${uuid1}`
                                    },
                                    resourceType: 'PractitionerRole'
                                }
                            ],
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                }
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
            const args = {'base_version': '4_0_0', 'id': uuid10};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid10,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid10}`,
                        resource: {
                            id: uuid10,
                            organization: {
                                reference: `Organization/${uuid100}`
                            },
                            practitioner: {
                                reference: `Practitioner/${uuid1}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    },
                    {
                        id: uuid100,
                        fullUrl: `https://host/4_0_0/Organization/${uuid100}`,
                        resource: {
                            id: uuid100,
                            resourceType: 'Organization'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                }
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': uuid1, '_hash_references': 1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            contained: [
                                {
                                    id: uuid10,
                                    practitioner: {
                                        reference: `Practitioner/#${uuid1}`
                                    },
                                    resourceType: 'PractitionerRole'
                                }
                            ],
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                    _uuid: `Organization/${uuid100}`
                }
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
            const args = {'base_version': '4_0_0', 'id': uuid1};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid10,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid10}`,
                        resource: {
                            id: uuid10,
                            organization: {
                                reference: `Organization/${uuid100}`
                            },
                            practitioner: {
                                reference: `Practitioner/${uuid1}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    },
                    {
                        id: uuid100,
                        fullUrl: `https://host/4_0_0/Organization/${uuid100}`,
                        resource: {
                            id: uuid100,
                            resourceType: 'Organization'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                    _uuid: `Organization/${uuid100}`
                }
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`
                }
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
            const args = {'base_version': '4_0_0', 'id': `${uuid1},${uuid2}`};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid2,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid2}`,
                        resource: {
                            id: uuid2,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid10,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid10}`,
                        resource: {
                            id: uuid10,
                            organization: {
                                reference: `Organization/${uuid100}`
                            },
                            practitioner: {
                                reference: `Practitioner/${uuid1}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    },
                    {
                        id: uuid100,
                        fullUrl: `https://host/4_0_0/Organization/${uuid100}`,
                        resource: {
                            id: uuid100,
                            resourceType: 'Organization'
                        }
                    },
                    {
                        id: uuid20,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid20}`,
                        resource: {
                            id: uuid20,
                            organization: {
                                reference: `Organization/${uuid200}`
                            },
                            practitioner: {
                                reference: `Practitioner/${uuid2}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    },
                    {
                        id: uuid200,
                        fullUrl: `https://host/4_0_0/Organization/${uuid200}`,
                        resource: {
                            id: uuid200,
                            resourceType: 'Organization'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                    _uuid: `Organization/${uuid100}`
                }
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`
                }
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
            const args = {'base_version': '4_0_0', 'id': `${uuid1},${uuid2}`};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            contained: [
                                {
                                    id: uuid10,
                                    organization: {
                                        reference: `Organization/${uuid100}`
                                    },
                                    practitioner: {
                                        reference: `Practitioner/${uuid1}`
                                    },
                                    resourceType: 'PractitionerRole'
                                },
                                {
                                    id: uuid100,
                                    resourceType: 'Organization'
                                }
                            ],
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid2,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid2}`,
                        resource: {
                            contained: [
                                {
                                    id: uuid20,
                                    organization: {
                                        reference: `Organization/${uuid200}`
                                    },
                                    practitioner: {
                                        reference: `Practitioner/${uuid2}`
                                    },
                                    resourceType: 'PractitionerRole'
                                },
                                {
                                    id: uuid200,
                                    resourceType: 'Organization'
                                }
                            ],
                            id: uuid2,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                    reference: `Practitioner/${uuid1}`
                },
                organization: {
                    reference: `Organization/${uuid100}`
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://clienthealth.org/IDHP'
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                }
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                    }
                ]
            });
            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _sourceId: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                _uuid: uuidAetna,
                resourceType: resourceType
            });

            resourceType = 'PractitionerRole';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': uuid10};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid10,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid10}`,
                        resource: {
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'for_system',
                                            valueUri: 'http://clienthealth.org/IDHP'
                                        },
                                        {
                                            url: 'availability_score',
                                            valueDecimal: 0.1234567890123
                                        }
                                    ],
                                    id: 'IDHP',
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                                },
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference:
                                                    `InsurancePlan/${uuidAetna}`
                                            }
                                        }
                                    ],
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                                }
                            ],
                            id: uuid10,
                            organization: {
                                reference: `Organization/${uuid100}`
                            },
                            practitioner: {
                                reference: `Practitioner/${uuid1}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    },
                    {
                        id: uuidAetna,
                        fullUrl:
                            `https://host/4_0_0/InsurancePlan/${uuidAetna}`,
                        resource: {
                            id: uuidAetna,
                            resourceType: 'InsurancePlan'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                            }
                        }
                    }
                ]
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
                    _uuid: `Organization/${uuid100}`
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://clienthealth.org/IDHP'
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                }
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                    }
                ]
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`
                }
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
                resourceType: resourceType
            });

            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': `${uuid1},${uuid2}`};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid2,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid2}`,
                        resource: {
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: `InsurancePlan/${uuid2000}`
                                            }
                                        }
                                    ]
                                }
                            ],
                            id: uuid2,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid10,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid10}`,
                        resource: {
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'for_system',
                                            valueUri: 'http://clienthealth.org/IDHP'
                                        },
                                        {
                                            url: 'availability_score',
                                            valueDecimal: 0.1234567890123
                                        }
                                    ],
                                    id: 'IDHP',
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                                },
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: `InsurancePlan/${uuidAetna}`
                                            }
                                        }
                                    ],
                                    url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                                }
                            ],
                            id: uuid10,
                            organization: {
                                reference: `Organization/${uuid100}`
                            },
                            practitioner: {
                                reference: `Practitioner/${uuid1}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    },
                    {
                        id: uuidAetna,
                        fullUrl:
                            `https://host/4_0_0/InsurancePlan/${uuidAetna}`,
                        resource: {
                            id: uuidAetna,
                            resourceType: 'InsurancePlan'
                        }
                    },
                    {
                        id: uuid100,
                        fullUrl: `https://host/4_0_0/Organization/${uuid100}`,
                        resource: {
                            id: uuid100,
                            resourceType: 'Organization'
                        }
                    },
                    {
                        id: uuid20,
                        fullUrl: `https://host/4_0_0/PractitionerRole/${uuid20}`,
                        resource: {
                            id: uuid20,
                            organization: {
                                reference: `Organization/${uuid200}`
                            },
                            practitioner: {
                                reference: `Practitioner/${uuid2}`
                            },
                            resourceType: 'PractitionerRole'
                        }
                    },
                    {
                        id: uuid200,
                        fullUrl: `https://host/4_0_0/Organization/${uuid200}`,
                        resource: {
                            id: uuid200,
                            resourceType: 'Organization'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                                reference: 'InsurancePlan/2000'
                            }
                        }
                    }
                ]
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
                    _uuid: `Organization/${uuid100}`
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://clienthealth.org/IDHP'
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                }
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                    }
                ]
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`
                }
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
                resourceType: resourceType
            });
            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', 'id': `${uuid1},${uuid2}`};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            contained: [
                                {
                                    extension: [
                                        {
                                            extension: [
                                                {
                                                    url: 'for_system',
                                                    valueUri: 'http://clienthealth.org/IDHP'
                                                },
                                                {
                                                    url: 'availability_score',
                                                    valueDecimal: 0.1234567890123
                                                }
                                            ],
                                            id: 'IDHP',
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                                        },
                                        {
                                            extension: [
                                                {
                                                    url: 'plan',
                                                    valueReference: {
                                                        reference: `InsurancePlan/${uuidAetna}`
                                                    }
                                                }
                                            ],
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                                        }
                                    ],
                                    id: uuid10,
                                    organization: {
                                        reference: `Organization/${uuid100}`
                                    },
                                    practitioner: {
                                        reference: `Practitioner/${uuid1}`
                                    },
                                    resourceType: 'PractitionerRole'
                                },
                                {
                                    id: uuidAetna,
                                    resourceType: 'InsurancePlan'
                                },
                                {
                                    id: uuid100,
                                    resourceType: 'Organization'
                                }
                            ],
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid2,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid2}`,
                        resource: {
                            contained: [
                                {
                                    id: uuid20,
                                    organization: {
                                        reference: `Organization/${uuid200}`
                                    },
                                    practitioner: {
                                        reference: `Practitioner/${uuid2}`
                                    },
                                    resourceType: 'PractitionerRole'
                                },
                                {
                                    id: uuid200,
                                    resourceType: 'Organization'
                                }
                            ],
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: 'InsurancePlan/2000'
                                            }
                                        }
                                    ]
                                }
                            ],
                            id: uuid2,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'searchset'
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
                                reference: 'InsurancePlan/2000'
                            }
                        }
                    }
                ]
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
                    _uuid: `Organization/${uuid100}`
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://clienthealth.org/IDHP'
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                }
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                    }
                ]
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`
                }
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
                resourceType: resourceType
            });
            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', _debug: 1, 'id': `${uuid1},${uuid2}`};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args: args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                        id: uuid1,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid1}`,
                        resource: {
                            contained: [
                                {
                                    extension: [
                                        {
                                            extension: [
                                                {
                                                    url: 'for_system',
                                                    valueUri: 'http://clienthealth.org/IDHP'
                                                },
                                                {
                                                    url: 'availability_score',
                                                    valueDecimal: 0.1234567890123
                                                }
                                            ],
                                            id: 'IDHP',
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                                        },
                                        {
                                            extension: [
                                                {
                                                    url: 'plan',
                                                    valueReference: {
                                                        reference: `InsurancePlan/${uuidAetna}`
                                                    }
                                                }
                                            ],
                                            url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                                        }
                                    ],
                                    id: uuid10,
                                    organization: {
                                        reference: `Organization/${uuid100}`
                                    },
                                    practitioner: {
                                        reference: `Practitioner/${uuid1}`
                                    },
                                    resourceType: 'PractitionerRole'
                                },
                                {
                                    id: uuidAetna,
                                    resourceType: 'InsurancePlan'
                                },
                                {
                                    id: uuid100,
                                    resourceType: 'Organization'
                                }
                            ],
                            id: uuid1,
                            resourceType: 'Practitioner'
                        }
                    },
                    {
                        id: uuid2,
                        fullUrl: `https://host/4_0_0/Practitioner/${uuid2}`,
                        resource: {
                            contained: [
                                {
                                    id: uuid20,
                                    organization: {
                                        reference: `Organization/${uuid200}`
                                    },
                                    practitioner: {
                                        reference: `Practitioner/${uuid2}`
                                    },
                                    resourceType: 'PractitionerRole'
                                },
                                {
                                    id: uuid200,
                                    resourceType: 'Organization'
                                }
                            ],
                            extension: [
                                {
                                    extension: [
                                        {
                                            url: 'plan',
                                            valueReference: {
                                                reference: 'InsurancePlan/2000'
                                            }
                                        }
                                    ]
                                }
                            ],
                            id: uuid2,
                            resourceType: 'Practitioner'
                        }
                    }
                ],
                'meta': {
                    'tag': [
                        {
                            'display': "db.Practitioner_4_0_0.find({'_uuid':{'$in':['c87b8e53-b3db-53a0-aa92-05f4a3fb9d15','941f082a-39a9-5f55-9630-5839a010e1bc']}}, {'_id':0})  | db.PractitionerRole_4_0_0.find({'$or':[{'practitioner._uuid':{'$in':['Practitioner/c87b8e53-b3db-53a0-aa92-05f4a3fb9d15','Practitioner/941f082a-39a9-5f55-9630-5839a010e1bc']}},{'practitioner._sourceId':{'$in':['Practitioner/1','Practitioner/2']}}]}, {}) | db.Organization_4_0_0.find({'$or':[{'_uuid':{'$in':['a10b7ea7-4439-5613-be67-ff64a5e45c1c','199445e8-35aa-576b-84ae-839040a283ab']}},{'_sourceId':{'$in':['100','200']}}]}, {}) | db.InsurancePlan_4_0_0.find({'$or':[{'_uuid':'92eb2ca3-db97-51a4-b2f8-ae979d89952e'},{'_sourceId':'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'}]}, {})",
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
                type: 'searchset'
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
                                _uuid: `InsurancePlan/${uuid2000}`
                            }
                        }
                    }
                ]
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
                    _uuid: `Organization/${uuid100}`
                },
                extension: [
                    {
                        id: 'IDHP',
                        extension: [
                            {
                                url: 'for_system',
                                valueUri: 'http://clienthealth.org/IDHP'
                            },
                            {
                                url: 'availability_score',
                                valueDecimal: 0.1234567890123
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/provider_search'
                    },
                    {
                        extension: [
                            {
                                url: 'plan',
                                valueReference: {
                                    reference:
                                        'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    _uuid: `InsurancePlan/${uuidAetna}`
                                }
                            }
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                    }
                ]
            });
            await collection.insertOne({
                id: '20',
                _sourceId: '20',
                _uuid: uuid20,
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                    _sourceId: 'Practitioner/2',
                    _uuid: `Practitioner/${uuid2}`
                },
                organization: {
                    reference: 'Organization/200',
                    _sourceId: 'Organization/200',
                    _uuid: `Organization/${uuid200}`
                }
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
                resourceType: resourceType
            });
            resourceType = 'Practitioner';
            /**
             * @type {R4ArgsParser}
             */
            const r4ArgsParser = container.r4ArgsParser;
            const args = {'base_version': '4_0_0', _explain: 1, 'id': `${uuid1},${uuid2}`};
            const parsedArgs = r4ArgsParser.parseArgs({resourceType, args});
            parsedArgs.headers = {'prefer': 'global_id=true'};
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
                            'display': "db.Practitioner_4_0_0.find({'_uuid':{'$in':['c87b8e53-b3db-53a0-aa92-05f4a3fb9d15','941f082a-39a9-5f55-9630-5839a010e1bc']}}, {'_id':0})  | db.PractitionerRole_4_0_0.find({'$or':[{'practitioner._uuid':'Practitioner/c87b8e53-b3db-53a0-aa92-05f4a3fb9d15'},{'practitioner._sourceId':'Practitioner/1'}]}, {}) | db.Organization_4_0_0.find({'$or':[{'_uuid':'a10b7ea7-4439-5613-be67-ff64a5e45c1c'},{'_sourceId':'100'}]}, {}) | db.InsurancePlan_4_0_0.find({'$or':[{'_uuid':'92eb2ca3-db97-51a4-b2f8-ae979d89952e'},{'_sourceId':'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'}]}, {})"
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryCollection',
                            'code': 'Practitioner_4_0_0|PractitionerRole_4_0_0|Organization_4_0_0|InsurancePlan_4_0_0'
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
                            'system': 'https://www.icanbwell.com/queryTime'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryOptimization',
                            'display': '{\'useTwoStepSearchOptimization\':undefined}'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryExplain'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryExplainSimple'
                        }
                    ]
                },
                'type': 'searchset',
                'entry': [
                    {
                        'id': uuid1,
                        'fullUrl': `https://host/4_0_0/Practitioner/${uuid1}`,
                        'resource': {
                            'resourceType': 'Practitioner',
                            'id': uuid1,
                            'contained': [
                                {
                                    'resourceType': 'PractitionerRole',
                                    'id': uuid10,
                                    'extension': [
                                        {
                                            'id': 'IDHP',
                                            'extension': [
                                                {
                                                    'url': 'for_system',
                                                    'valueUri': 'http://clienthealth.org/IDHP'
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
                                                        'reference': `InsurancePlan/${uuidAetna}`
                                                    }
                                                }
                                            ],
                                            'url': 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan'
                                        }
                                    ],
                                    'practitioner': {
                                        'reference': `Practitioner/${uuid1}`
                                    },
                                    'organization': {
                                        'reference': `Organization/${uuid100}`
                                    }
                                },
                                {
                                    'resourceType': 'InsurancePlan',
                                    'id': uuidAetna
                                },
                                {
                                    'resourceType': 'Organization',
                                    'id': uuid100
                                }
                            ]
                        }
                    }
                ]
            });
        });
    });
});
