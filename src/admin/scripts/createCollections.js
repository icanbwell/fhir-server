const { createContainer } = require('../../createContainer');
const { CreateCollectionsRunner } = require('../runners/createCollectionsRunner');
const { AdminLogger } = require('../adminLogger');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register(
        'createCollectionsRunner',
        (c) =>
            new CreateCollectionsRunner({
                indexManager: c.indexManager,
                adminLogger: new AdminLogger(),
                mongoDatabaseManager: c.mongoDatabaseManager
            })
    );

    /**
     * @type {CreateCollectionsRunner}
     */
    const createCollectionsRunner = container.createCollectionsRunner;
    await createCollectionsRunner.processAsync();

    process.exit(0);
}

/**
 * This script creates all collections and indexes in the database.
 * It creates all resource collections and their history collections.
 * It also creates the access logs collection and the audit event collection.
 *
 * To run this:
 * Add the following environment variables
 * MONGO_URL, MONGO_USERNAME, MONGO_PASSWORD, MONGO_DB_NAME
 * RESOURCE_HISTORY_MONGO_URL, RESOURCE_HISTORY_MONGO_USERNAME, RESOURCE_HISTORY_MONGO_PASSWORD, RESOURCE_HISTORY_MONGO_DB_NAME
 * AUDIT_EVENT_MONGO_URL, AUDIT_EVENT_MONGO_USERNAME, AUDIT_EVENT_MONGO_PASSWORD, AUDIT_EVENT_MONGO_DB_NAME
 * ACCESS_LOGS_CLUSTER_MONGO_URL, ACCESS_LOGS_MONGO_USERNAME, ACCESS_LOGS_MONGO_PASSWORD, ACCESS_LOGS_MONGO_DB_NAME
 *
 * Command: node src/admin/scripts/createCollections
 */
main().catch((reason) => {
    console.error(reason);
});
