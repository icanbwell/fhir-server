const {processGraph} = require('../../../src/operations/graph/graphHelpers');
const {commonBeforeEach, commonAfterEach} = require('../common');
const globals = require('../../globals');
const {CLIENT_DB} = require('../../constants');
const graphDefinition = require('./fixtures/graph.json');

describe('graphHelper Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('graphHelper Tests', () => {
        test('graphHelper works', async () => {
            let db = globals.get(CLIENT_DB);
            const base_version = '4_0_0';
            let collection_name = 'Practitioner';
            let collection = db.collection(`${collection_name}_${base_version}`);
            collection.insertOne({id: '1', resourceType: 'Practitioner'});
            const result = await processGraph(
                db,
                collection_name,
                base_version,
                collection_name,
                null,
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
                'entry': [],
                'id': 'bundle-example',
                'resourceType': 'Bundle',
                'type': 'collection'
            });
        });
    });
});
