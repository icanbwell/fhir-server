const { createContainer } = require('../../createContainer');
const { AdminLogger } = require('../adminLogger');
const { createAllAtlasSearchIndexesAsync } = require('./atlasSearchIndexHelper');

const BASE_VERSION = '4_0_0';

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

    await createAllAtlasSearchIndexesAsync({
        getCollectionAsync: async (resourceType) => {
            const resourceLocator = resourceLocatorFactory.createResourceLocator({ resourceType, base_version: BASE_VERSION });
            return resourceLocator.getCollectionAsync({});
        },
        adminLogger
    });

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
