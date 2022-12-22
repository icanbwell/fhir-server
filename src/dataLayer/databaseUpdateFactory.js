const {DatabaseUpdateManager} = require('./databaseUpdateManager');
const {ResourceLocatorFactory} = require('../operations/common/resourceLocatorFactory');
const {assertTypeEquals} = require('../utils/assertType');
const {ResourceMerger} = require('../operations/common/resourceMerger');
const {PreSaveManager} = require('../preSaveHandlers/preSave');
const {DatabaseQueryFactory} = require('./databaseQueryFactory');

class DatabaseUpdateFactory {
    /**
     * constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ResourceMerger} resourceMerger
     * @param {PreSaveManager} preSaveManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor(
        {
            resourceLocatorFactory,
            resourceMerger,
            preSaveManager,
            databaseQueryFactory
        }
    ) {
        /**
         * @type {ResourceLocatorFactory}
         */
        this.resourceLocatorFactory = resourceLocatorFactory;
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * create a database update manager for this resource type
     * @param {string} resourceType
     * @param {string} base_version
     * @return {DatabaseUpdateManager}
     */
    createDatabaseUpdateManager({resourceType, base_version}) {
        return new DatabaseUpdateManager(
            {
                resourceLocatorFactory: this.resourceLocatorFactory,
                resourceMerger: this.resourceMerger,
                preSaveManager: this.preSaveManager,
                databaseQueryFactory: this.databaseQueryFactory,
                resourceType,
                base_version
            }
        );
    }
}

module.exports = {
    DatabaseUpdateFactory
};
