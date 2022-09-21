// load config from .env.  Should be first thing so env vars are available to rest of the code
const path = require('path');
const dotenv = require('dotenv');
const pathToEnv = path.resolve(__dirname, '.env');
dotenv.config({
    path: pathToEnv
});
console.log(`Reading config from ${pathToEnv}`);
console.log(`AUDIT_EVENT_MONGO_URL=${process.env.AUDIT_EVENT_MONGO_URL}`);
const {createContainer} = require('../../createContainer');
const {assertTypeEquals} = require('../../utils/assertType');
const {CommandLineParser} = require('./commandLineParser');
const {BaseScriptRunner} = require('./baseScriptRunner');
const {IndexManager} = require('../../indexes/indexManager');
const globals = require('../../globals');
const {AUDIT_EVENT_CLIENT_DB, CLIENT_DB} = require('../../constants');


/**
 * @classdesc Copies documents from source collection into the appropriate partitioned collection
 */
class IndexCollectionsRunner extends BaseScriptRunner {
    /**
     * constructor
     * @param {IndexManager} indexManager
     * @param {string|undefined} [collectionName]
     * @param {boolean|undefined} [dropIndexes]
     * @param {string|undefined} [dbName]
     */
    constructor(
        {
            indexManager,
            collectionName,
            dropIndexes,
            dbName
        }
    ) {
        super();
        /**
         * @type {IndexManager}
         */
        this.indexManager = indexManager;
        assertTypeEquals(indexManager, IndexManager);

        /**
         * @type {string|undefined}
         */
        this.collectionName = collectionName;

        /**
         * @type {boolean|undefined}
         */
        this.dropIndexes = dropIndexes;

        /**
         * @type {string|undefined}
         */
        this.dbName = dbName;
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        try {
            await this.init();
            /**
             * @type {string}
             */
            const dbName = this.dbName === 'audit-event' ? AUDIT_EVENT_CLIENT_DB : CLIENT_DB;
            /**
             * @type {import('mongodb').Db}
             */
            const db = globals.get(dbName);
            if (this.dropIndexes) {
                await this.indexManager.deleteIndexesInAllCollectionsInDatabase({
                    db,
                    collectionRegex: this.collectionName
                });
            }
            await this.indexManager.indexAllCollectionsInDatabaseAsync({
                db,
                collectionRegex: this.collectionName
            });
        } catch (e) {
            console.log(`ERROR: ${e}`);
        } finally {
            await this.shutdown();
        }
    }
}

/**
 * main function
 * @returns {Promise<void>}
 */
async function main() {
    /**
     * @type {Object}
     */
    const parameters = CommandLineParser.parseCommandLine();
    // set up all the standard services in the container
    const container = createContainer();

    // now add our class
    container.register('indexCollectionsRunner', (c) => new IndexCollectionsRunner({
        indexManager: c.indexManager,
        collectionName: parameters.collection,
        dropIndexes: parameters.drop,
        dbName: parameters.db
    }));

    /**
     * @type {IndexCollectionsRunner}
     */
    const indexCollectionsRunner = container.indexCollectionsRunner;
    await indexCollectionsRunner.processAsync();

    process.exit(0);
}

/**
 * To run this:
 * nvm use 16.17.0
 * node src/admin/scripts/indexCollections --collection=Patient_4_0_0 --drop --db=fhir
 * node src/admin/scripts/indexCollections --collection=AuditEvent_4_0_0 --drop --db=audit-event
 * collection can be a regex
 */
main().catch(reason => {
    console.error(reason);
});
