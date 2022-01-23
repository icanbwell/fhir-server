const {processGraph} = require('../../../src/operations/graph/graphHelpers');
const {commonBeforeEach, commonAfterEach} = require('../common');
const globals = require('../../globals');
const {CLIENT_DB} = require('../../constants');
const graphDefinition = require('./fixtures/graph.json');

describe('graphHelper Tests', () => {
    const base_version = '4_0_0';
    beforeEach(async () => {
        await commonBeforeEach();
        let db = globals.get(CLIENT_DB);
        let collection_name = 'Practitioner';
        let collection = db.collection(`${collection_name}_${base_version}`);

        await collection.insertOne({_id: '1', id: '1', resourceType: 'Practitioner'});
        // const doc = await collection.findOne({id: '1'});
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('graphHelper Tests', () => {
        test('graphHelper single Practitioner works', async () => {
            let db = globals.get(CLIENT_DB);
            let collection_name = 'Practitioner';
            const result = await processGraph(
                db,
                collection_name,
                base_version,
                collection_name,
                ['*'],
                'user',
                'user/*.read access/*.*',
                'host',
                ['1'],
                graphDefinition,
                false,
                false
            );
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result).toStrictEqual({
                'entry': [
                    {
                        'fullUrl': 'https://host/4_0_0/Practitioner/1',
                        'resource': {
                            'id': '1',
                            'resourceType': 'Practitioner'
                        }
                    }
                ],
                'id': 'bundle-example',
                'resourceType': 'Bundle',
                'type': 'collection'
            });
        });
        test('graphHelper multiple Practitioners works', async () => {
            let db = globals.get(CLIENT_DB);
            let collection_name = 'Practitioner';
            let collection = db.collection(`${collection_name}_${base_version}`);

            await collection.insertOne({_id: '2', id: '2', resourceType: 'Practitioner'});
            const result = await processGraph(
                db,
                collection_name,
                base_version,
                collection_name,
                ['*'],
                'user',
                'user/*.read access/*.*',
                'host',
                ['1', '2'],
                graphDefinition,
                false,
                false
            );
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result).toStrictEqual({
                'entry': [
                    {
                        'fullUrl': 'https://host/4_0_0/Practitioner/1',
                        'resource': {
                            'id': '1',
                            'resourceType': 'Practitioner'
                        }
                    },
                    {
                        'fullUrl': 'https://host/4_0_0/Practitioner/2',
                        'resource': {
                            'id': '2',
                            'resourceType': 'Practitioner'
                        }
                    }
                ],
                'id': 'bundle-example',
                'resourceType': 'Bundle',
                'type': 'collection'
            });
        });
        test('graphHelper single Practitioner with 1 level nesting works', async () => {
            let db = globals.get(CLIENT_DB);
            let resourceType = 'PractitionerRole';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne(
                {_id: '10', id: '10', resourceType: resourceType, practitioner: {reference: 'Practitioner/1'}}
            );

            let collection_name = 'Practitioner';
            const result = await processGraph(
                db,
                collection_name,
                base_version,
                collection_name,
                ['*'],
                'user',
                'user/*.read access/*.*',
                'host',
                ['1'],
                graphDefinition,
                false,
                false
            );
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result).toStrictEqual({
                'entry': [
                    {
                        'fullUrl': 'https://host/4_0_0/Practitioner/1',
                        'resource': {
                            'id': '1',
                            'resourceType': 'Practitioner'
                        }
                    },
                    {
                        'fullUrl': 'https://host/4_0_0/PractitionerRole/10',
                        'resource': {
                            'id': '10',
                            'practitioner': {
                                'reference': 'Practitioner/1'
                            },
                            'resourceType': 'PractitionerRole'
                        }
                    }
                ],
                'id': 'bundle-example',
                'resourceType': 'Bundle',
                'type': 'collection'
            });
        });
        test('graphHelper single Practitioner with 2 level nesting works', async () => {
            let db = globals.get(CLIENT_DB);
            // add a PractitionerRole
            let resourceType = 'PractitionerRole';
            let collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne(
                {
                    _id: '10',
                    id: '10',
                    resourceType: resourceType,
                    practitioner: {
                        reference: 'Practitioner/1'
                    },
                    organization: {
                        reference: 'Organization/100'
                    }
                }
            );
            // add an Organization
            resourceType = 'Organization';
            collection = db.collection(`${resourceType}_${base_version}`);
            await collection.insertOne(
                {_id: '100', id: '100', resourceType: resourceType}
            );

            let collection_name = 'Practitioner';
            const result = await processGraph(
                db,
                collection_name,
                base_version,
                collection_name,
                ['*'],
                'user',
                'user/*.read access/*.*',
                'host',
                ['1'],
                graphDefinition,
                false,
                false
            );
            expect(result).not.toBeNull();
            delete result['timestamp'];
            expect(result).toStrictEqual({
                'entry': [
                    {
                        'fullUrl': 'https://host/4_0_0/Practitioner/1',
                        'resource': {
                            'id': '1',
                            'resourceType': 'Practitioner'
                        }
                    },
                    {
                        'fullUrl': 'https://host/4_0_0/PractitionerRole/10',
                        'resource': {
                            'id': '10',
                            'organization': {
                                'reference': 'Organization/100'
                            },
                            'practitioner': {
                                'reference': 'Practitioner/1'
                            },
                            'resourceType': 'PractitionerRole'
                        }
                    },
                    {
                        'fullUrl': 'https://host/4_0_0/Organization/100',
                        'resource': {
                            'id': '100',
                            'resourceType': 'Organization'
                        }
                    }
                ],
                'id': 'bundle-example',
                'resourceType': 'Bundle',
                'type': 'collection'
            });
        });
    });
});
