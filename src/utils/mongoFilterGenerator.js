const {assertTypeEquals} = require('./assertType');
const {ConfigManager} = require('./configManager');

/**
 * @classdesc Generates filters for use in Mongo queries
 */
class MongoFilterGenerator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor({
                    configManager
                }
    ) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Returns a filter for use in searchin by id and security tags
     * @param {string} id
     * @param {SecurityTagStructure} securityTagStructure
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    generateFilterForIdAndSecurityTags({id, securityTagStructure}) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        let filter = {'id': id.toString()};
        if (this.configManager.enableGlobalIdSupport && securityTagStructure.sourceAssigningAuthority.length > 0) {
            /**
             * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
             */
            const sourceAssigningAuthorityFilter = securityTagStructure.sourceAssigningAuthority.length > 1 ?
                {
                    $or: securityTagStructure.sourceAssigningAuthority.map(
                        sa => {
                            return {
                                [`_sourceAssigningAuthority.${sa}`]: 1
                            };
                        }
                    )
                } :
                {[`_sourceAssigningAuthority.${securityTagStructure.sourceAssigningAuthority[0]}`]: 1};
            filter = {
                $and: [
                    {'_sourceId': id.toString()},
                    sourceAssigningAuthorityFilter
                ]
            };
        }
        return filter;
    }

    /**
     * generates a mongo filter for lookup by uuid
     * @param {string} uuid
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    generateFilterForUuid({uuid}) {
        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        let filter = {'_uuid': uuid.toString()};
        return filter;
    }
}

module.exports = {
    MongoFilterGenerator
};
