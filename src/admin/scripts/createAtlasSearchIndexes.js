const fs = require('fs');
const path = require('path');
const { createContainer } = require('../../createContainer');
const { AdminLogger } = require('../adminLogger');

const BASE_VERSION = '4_0_0';
const INDEX_NAME = 'hybrid-full-text-search';
const RESOURCE_TYPES = ['Patient', 'Person', 'Practitioner'];
const DEFINITIONS_DIR = path.join(__dirname, 'atlasSearchIndexes');
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

/**
 * Reads this script's per-resource-type Atlas Search index definition file.
 * @param {string} resourceType
 * @returns {object}
 */
function readDefinition (resourceType) {
    const filePath = path.join(DEFINITIONS_DIR, `${resourceType.toLowerCase()}.json`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Polls a collection's named search index until it reports status READY, or throws once
 * POLL_TIMEOUT_MS has elapsed. Atlas builds the index asynchronously after creation, so a
 * caller that queries immediately after createSearchIndex() may see FAILED/PENDING/BUILDING.
 * @param {import('mongodb').Collection} collection
 * @param {AdminLogger} adminLogger
 * @returns {Promise<void>}
 */
async function waitForIndexReadyAsync (collection, adminLogger) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const indexes = await collection.listSearchIndexes(INDEX_NAME).toArray();
        const index = indexes[0];
        if (index && index.status === 'READY') {
            return;
        }
        if (index && index.status === 'FAILED') {
            throw new Error(
                `Search index '${INDEX_NAME}' on ${collection.collectionName} failed to build: ` +
                `${JSON.stringify(index.statusDetail || index)}`
            );
        }
        adminLogger.logInfo(
            `Waiting for search index '${INDEX_NAME}' on ${collection.collectionName} ` +
            `(status: ${index ? index.status : 'not found yet'})`
        );
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(
        `Timed out after ${POLL_TIMEOUT_MS}ms waiting for search index '${INDEX_NAME}' ` +
        `on ${collection.collectionName} to become READY`
    );
}

/**
 * Creates (or, if already present, drops and recreates) the `hybrid-full-text-search` Atlas
 * Search index on Patient_4_0_0/Person_4_0_0/Practitioner_4_0_0, from the JSON definitions in
 * ./atlasSearchIndexes/, then waits for each to reach READY. Requires a MongoDB deployment that
 * actually supports Atlas Search (e.g. the mongodb/mongodb-atlas-local image this repo's
 * docker-compose.yml now uses) -- plain mongod has no $search support and this will fail.
 * @returns {Promise<void>}
 */
async function main () {
    const container = createContainer();
    const adminLogger = new AdminLogger();
    /**
     * @type {import('../../operations/common/resourceLocatorFactory').ResourceLocatorFactory}
     */
    const resourceLocatorFactory = container.resourceLocatorFactory;

    for (const resourceType of RESOURCE_TYPES) {
        const definition = readDefinition(resourceType);
        const resourceLocator = resourceLocatorFactory.createResourceLocator({ resourceType, base_version: BASE_VERSION });
        const collection = await resourceLocator.getCollectionAsync({});

        const existingIndexes = await collection.listSearchIndexes(INDEX_NAME).toArray();
        if (existingIndexes.length > 0) {
            adminLogger.logInfo(
                `Search index '${INDEX_NAME}' already exists on ${collection.collectionName}; ` +
                'dropping and recreating so it matches the current definition file'
            );
            await collection.dropSearchIndex(INDEX_NAME);
        }

        await collection.createSearchIndex({ name: INDEX_NAME, definition });
        adminLogger.logInfo(`Submitted search index '${INDEX_NAME}' on ${collection.collectionName}`);
        await waitForIndexReadyAsync(collection, adminLogger);
        adminLogger.logInfo(`Search index '${INDEX_NAME}' on ${collection.collectionName} is READY`);
    }

    process.exit(0);
}

/**
 * This script creates the `hybrid-full-text-search` MongoDB Atlas Search index -- the same
 * index `person-matching-service` maintains on these collections in real Atlas environments --
 * on the local Atlas Search deployment, so this repo's ATLAS_SEARCH_ENABLED_* /
 * ATLAS_SEARCH_NATIVE_SORT_ENABLED feature flags (see
 * docs/adr/0003-atlas-search-for-patient-person-practitioner-lookup.md) can actually be tested
 * against a real $search-capable database locally.
 *
 * To run this:
 * Add the same MONGO_URL/MONGO_USERNAME/MONGO_PASSWORD/MONGO_DB_NAME environment variables
 * createCollections.js needs, pointed at a deployment that supports Atlas Search.
 *
 * Command: node src/admin/scripts/createAtlasSearchIndexes.js
 */
main().catch((reason) => {
    console.error(reason);
    process.exit(1);
});
