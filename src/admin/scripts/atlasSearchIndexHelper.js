const fs = require('fs');
const path = require('path');
const { ATLAS_SEARCH_INDEX_NAME } = require('../../operations/search/atlasSearchQueryBuilder');

const RESOURCE_TYPES = ['Patient', 'Person', 'Practitioner'];
const DEFINITIONS_DIR = path.join(__dirname, 'atlasSearchIndexes');
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

/**
 * Reads the per-resource-type Atlas Search index definition file from ./atlasSearchIndexes/.
 * @param {string} resourceType
 * @returns {object}
 */
function readIndexDefinition (resourceType) {
    const filePath = path.join(DEFINITIONS_DIR, `${resourceType.toLowerCase()}.json`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Polls a collection's named search index until it reports status READY, or throws once
 * POLL_TIMEOUT_MS has elapsed. Atlas builds the index asynchronously after creation, so a
 * caller that queries immediately after createSearchIndex() may see PENDING/BUILDING.
 * @param {import('mongodb').Collection} collection
 * @param {{logInfo: function(string): void}} adminLogger
 * @param {string} [indexName]
 * @returns {Promise<void>}
 */
async function waitForSearchIndexReadyAsync ({ collection, adminLogger, indexName = ATLAS_SEARCH_INDEX_NAME }) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const indexes = await collection.listSearchIndexes(indexName).toArray();
        const index = indexes[0];
        if (index && index.status === 'READY') {
            return;
        }
        if (index && index.status === 'FAILED') {
            throw new Error(
                `Search index '${indexName}' on ${collection.collectionName} failed to build: ` +
                `${JSON.stringify(index.statusDetail || index)}`
            );
        }
        adminLogger.logInfo(
            `Waiting for search index '${indexName}' on ${collection.collectionName} ` +
            `(status: ${index ? index.status : 'not found yet'})`
        );
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(
        `Timed out after ${POLL_TIMEOUT_MS}ms waiting for search index '${indexName}' ` +
        `on ${collection.collectionName} to become READY`
    );
}

/**
 * Creates (or, if already present, drops and recreates) the named Atlas Search index on
 * `collection`, from this resource type's definition file, then waits for it to reach READY.
 * @param {import('mongodb').Collection} collection
 * @param {string} resourceType
 * @param {{logInfo: function(string): void}} adminLogger
 * @param {string} [indexName]
 * @returns {Promise<void>}
 */
async function createOrUpdateSearchIndexAsync ({ collection, resourceType, adminLogger, indexName = ATLAS_SEARCH_INDEX_NAME }) {
    const definition = readIndexDefinition(resourceType);

    const existingIndexes = await collection.listSearchIndexes(indexName).toArray();
    if (existingIndexes.length > 0) {
        adminLogger.logInfo(
            `Search index '${indexName}' already exists on ${collection.collectionName}; ` +
            'dropping and recreating so it matches the current definition file'
        );
        await collection.dropSearchIndex(indexName);
    }

    await collection.createSearchIndex({ name: indexName, definition });
    adminLogger.logInfo(`Submitted search index '${indexName}' on ${collection.collectionName}`);
    await waitForSearchIndexReadyAsync({ collection, adminLogger, indexName });
    adminLogger.logInfo(`Search index '${indexName}' on ${collection.collectionName} is READY`);
}

/**
 * Creates the `hybrid-full-text-search` index on all of RESOURCE_TYPES's collections.
 * `getCollectionAsync` abstracts over how a caller resolves a resourceType to a real MongoDB
 * collection -- the CLI script resolves it via the app's ResourceLocatorFactory; test setup
 * resolves it via a plain MongoClient/db handle. Either way this is the same operation.
 * @param {function(string): Promise<import('mongodb').Collection>} getCollectionAsync
 * @param {{logInfo: function(string): void}} adminLogger
 * @returns {Promise<void>}
 */
async function createAllAtlasSearchIndexesAsync ({ getCollectionAsync, adminLogger }) {
    for (const resourceType of RESOURCE_TYPES) {
        const collection = await getCollectionAsync(resourceType);
        await createOrUpdateSearchIndexAsync({ collection, resourceType, adminLogger });
    }
}

module.exports = {
    RESOURCE_TYPES,
    readIndexDefinition,
    waitForSearchIndexReadyAsync,
    createOrUpdateSearchIndexAsync,
    createAllAtlasSearchIndexesAsync
};
