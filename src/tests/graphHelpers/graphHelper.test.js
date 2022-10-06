const {commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer} = require('../common');
const graphSimpleReverseDefinition = require('./fixtures/graphSimpleReverse.json');
const graphSimpleForwardDefinition = require('./fixtures/graphSimpleForward.json');
const graphDefinition = require('./fixtures/graph.json');
const graphWithExtensionDefinition = require('./fixtures/graphWithExtension.json');
const graphSimpleWithExtensionDefinition = require('./fixtures/graphSimpleWithExtension.json');
const {FhirRequestInfo} = require('../../utils/fhirRequestInfo');
const {createTestContainer} = require('../createTestContainer');
const {describe, beforeEach, afterEach, expect, test} = require('@jest/globals');

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

        await collection.insertOne({id: '1', resourceType: 'Practitioner'});
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
    });

    describe('graphHelper Tests', () => {
        test('graphHelper single Practitioner works', async () => {
            const resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1'],
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'collection',
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

            await collection.insertOne({id: '2', resourceType: 'Practitioner'});
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1', '2'],
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {reference: 'Practitioner/1'},
            });

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1'],
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {reference: 'Practitioner/1'},
            });

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1'],
                graphDefinitionJson: graphDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {reference: 'Practitioner/1'},
            });

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1'],
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: true,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {reference: 'Practitioner/1'},
            });

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1'],
                graphDefinitionJson: graphDefinition,
                contained: true,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});

            resourceType = 'PractitionerRole';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['10'],
                graphDefinitionJson: graphSimpleForwardDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {reference: 'Practitioner/1'},
            });

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1'],
                graphDefinitionJson: graphSimpleReverseDefinition,
                contained: true,
                hash_references: true,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1'],
                graphDefinitionJson: graphDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
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
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'collection',
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
            await collection.insertOne({id: '2', resourceType: 'Practitioner'});

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
                },
            });
            await collection.insertOne({
                id: '20',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                },
                organization: {
                    reference: 'Organization/200',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});
            await collection.insertOne({id: '200', resourceType: resourceType});

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1', '2'],
                graphDefinitionJson: graphDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/2',
                        resource: {
                            id: '2',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
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
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                    {
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
                        fullUrl: 'https://host/4_0_0/Organization/200',
                        resource: {
                            id: '200',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'collection',
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
            await collection.insertOne({id: '2', resourceType: 'Practitioner'});

            // add a PractitionerRole
            resourceType = 'PractitionerRole';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: '10',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
                },
            });
            await collection.insertOne({
                id: '20',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                },
                organization: {
                    reference: 'Organization/200',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});
            await collection.insertOne({id: '200', resourceType: resourceType});

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1', '2'],
                graphDefinitionJson: graphDefinition,
                contained: true,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
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
                resourceType: resourceType,
            });

            resourceType = 'PractitionerRole';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['10'],
                graphDefinitionJson: graphSimpleWithExtensionDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                                                    'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
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
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                },
                organization: {
                    reference: 'Organization/200',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});
            await collection.insertOne({id: '200', resourceType: resourceType});

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                resourceType: resourceType,
            });

            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1', '2'],
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: false,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
                        fullUrl: 'https://host/4_0_0/Practitioner/1',
                        resource: {
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
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
                                                    'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
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
                        fullUrl: 'https://host/4_0_0/Organization/100',
                        resource: {
                            id: '100',
                            resourceType: 'Organization',
                        },
                    },
                    {
                        fullUrl:
                            'https://host/4_0_0/InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                        resource: {
                            id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                            resourceType: 'InsurancePlan',
                        },
                    },
                    {
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
                        fullUrl: 'https://host/4_0_0/Organization/200',
                        resource: {
                            id: '200',
                            resourceType: 'Organization',
                        },
                    },
                ],
                id: '1',
                resourceType: 'Bundle',
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
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
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                },
                organization: {
                    reference: 'Organization/200',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});
            await collection.insertOne({id: '200', resourceType: resourceType});

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                resourceType: resourceType,
            });
            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1', '2'],
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: true,
                hash_references: false,
                args: {}
            });
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                                                        reference:
                                                            'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
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
                                    id: '100',
                                    resourceType: 'Organization',
                                },
                                {
                                    id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    resourceType: 'InsurancePlan',
                                },
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
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
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
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
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                },
                organization: {
                    reference: 'Organization/200',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});
            await collection.insertOne({id: '200', resourceType: resourceType});

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                resourceType: resourceType,
            });
            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1', '2'],
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: true,
                hash_references: false,
                args: {_debug: 1}
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
                if (tag.system === 'https://www.icanbwell.com/queryTime') {
                    delete tag['display'];
                }
            }
            expect(result.toJSON()).toStrictEqual({
                entry: [
                    {
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
                                                        reference:
                                                            'InsurancePlan/AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
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
                                    id: '100',
                                    resourceType: 'Organization',
                                },
                                {
                                    id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                                    resourceType: 'InsurancePlan',
                                },
                            ],
                            id: '1',
                            resourceType: 'Practitioner',
                        },
                    },
                    {
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
                            'display': 'db.Practitioner_4_0_0.find({\'id\':{\'$in\':[\'1\',\'2\']}}, {\'_id\':0})  | db.Practitioner_4_0_0.find({\'$and\':[{\'practitioner.reference\':{\'$in\':[\'Practitioner/1\',\'Practitioner/2\']}}]}, {}) | db.Practitioner_4_0_0.find({\'id\':{\'$in\':[\'100\',\'200\']}}, {}) | db.Practitioner_4_0_0.find({\'id\':{\'$in\':[\'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He\']}}, {})',
                            'system': 'https://www.icanbwell.com/query'
                        },
                        {
                            'code': 'Practitioner_4_0_0',
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
                        }
                    ]
                },

                id: '1',
                resourceType: 'Bundle',
                type: 'collection',
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
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/1',
                },
                organization: {
                    reference: 'Organization/100',
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
                                },
                            },
                        ],
                        url: 'https://raw.githubusercontent.com/imranq2/SparkAutoMapper.FHIR/main/StructureDefinition/insurance_plan',
                    },
                ],
            });
            await collection.insertOne({
                id: '20',
                resourceType: resourceType,
                practitioner: {
                    reference: 'Practitioner/2',
                },
                organization: {
                    reference: 'Organization/200',
                },
            });
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({id: '100', resourceType: resourceType});
            await collection.insertOne({id: '200', resourceType: resourceType});

            // add an InsurancePlan
            resourceType = 'InsurancePlan';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne({
                id: 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He',
                resourceType: resourceType,
            });
            resourceType = 'Practitioner';
            const result = await getGraphHelper().processGraphAsync({
                requestInfo,
                base_version,
                useAtlas: false,
                resourceType,
                id: ['1', '2'],
                graphDefinitionJson: graphWithExtensionDefinition,
                contained: true,
                hash_references: false,
                args: {_explain: 1}
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
                            'display': 'db.Practitioner_4_0_0.find({\'id\':{\'$in\':[\'1\',\'2\']}}, {\'_id\':0})  | db.Practitioner_4_0_0.find({\'$and\':[{\'practitioner.reference\':\'Practitioner/1\'}]}, {}) | db.Practitioner_4_0_0.find({\'id\':{\'$in\':[\'100\']}}, {}) | db.Practitioner_4_0_0.find({\'id\':{\'$in\':[\'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He\']}}, {})'
                        },
                        {
                            'system': 'https://www.icanbwell.com/queryCollection',
                            'code': 'Practitioner_4_0_0'
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
                        }
                    ]
                },
                'type': 'collection',
                'entry': [
                    {
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
                                        'reference': 'Practitioner/1'
                                    },
                                    'organization': {
                                        'reference': 'Organization/100'
                                    }
                                },
                                {
                                    'resourceType': 'Organization',
                                    'id': '100'
                                },
                                {
                                    'resourceType': 'InsurancePlan',
                                    'id': 'AETNA-Aetna-Elect-Choice--EPO--Aetna-Health-Fund--Innovation-He'
                                }
                            ]
                        }
                    }
                ]
            });
        });
    });
});
