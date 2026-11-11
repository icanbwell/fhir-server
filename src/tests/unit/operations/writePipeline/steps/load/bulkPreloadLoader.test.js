const { describe, test, expect } = require('@jest/globals');
const { BulkPreloadLoader } = require('../../../../../../operations/writePipeline/steps/load/bulkPreloadLoader');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { DatabaseBulkLoader } = require('../../../../../../dataLayer/databaseBulkLoader');
const { DatabaseQueryFactory } = require('../../../../../../dataLayer/databaseQueryFactory');
const { RequestSpecificCache } = require('../../../../../../utils/requestSpecificCache');
const { ConfigManager } = require('../../../../../../utils/configManager');

/**
 * The `_uuid` of the stored Patient.
 */
const STORED_UUID = '00000000-0000-4000-8000-00000000000a';
/**
 * A `_uuid` with no stored document.
 */
const MISSING_UUID = '00000000-0000-4000-8000-00000000000b';

/**
 * Builds the synthetic stored Patient.
 */
const buildStoredPatient = () => ({
    resourceType: 'Patient',
    id: 'stored-1',
    _uuid: STORED_UUID,
    meta: { versionId: '1', source: 'http://example.com/source' },
    name: [{ family: 'Synthetic' }]
});

/**
 * Builds a query factory whose bulk find returns `storedDocuments` and whose single find returns
 * null.
 */
const buildDatabaseQueryFactory = (storedDocuments) => {
    const databaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
    databaseQueryFactory.createQuery = () => ({
        findResourcesInDatabaseAsync: async () => ({ toArrayAsync: async () => storedDocuments }),
        fastFindOneAsync: async () => null
    });
    return databaseQueryFactory;
};

/**
 * Builds a Patient item at `index` with the given `_uuid`.
 */
const buildItem = ({ index, uuid }) => new WriteItem({
    index,
    incoming: { resourceType: 'Patient', id: `item-${index}`, _uuid: uuid }
});

describe('BulkPreloadLoader', () => {
    test('gives every item with the same uuid its own copy of the stored document', async () => {
        const databaseQueryFactory = buildDatabaseQueryFactory([buildStoredPatient()]);
        const loader = new BulkPreloadLoader({
            databaseBulkLoader: new DatabaseBulkLoader({
                databaseQueryFactory,
                requestSpecificCache: new RequestSpecificCache(),
                configManager: new ConfigManager()
            }),
            databaseQueryFactory
        });
        const items = [
            buildItem({ index: 0, uuid: STORED_UUID }),
            buildItem({ index: 1, uuid: MISSING_UUID }),
            buildItem({ index: 2, uuid: STORED_UUID }),
            buildItem({ index: 3, uuid: STORED_UUID })
        ];
        const context = new WriteContext({
            requestInfo: { requestId: 'synthetic-request' },
            base_version: '4_0_0',
            parsedArgs: {},
            smartMerge: true,
            operationName: 'merge'
        });

        await loader.loadAsync({ items, context });
        items[0].stored.name.push({ family: 'ChangedByFirst' });
        items[2].stored.meta.versionId = 'changed-by-third';

        expect(items[1].stored).toBeNull();
        expect(items[0].stored.meta.versionId).toBe('1');
        expect(items[2].stored.name).toStrictEqual([{ family: 'Synthetic' }]);
        expect(items[3].stored).toStrictEqual(buildStoredPatient());
    });
});
