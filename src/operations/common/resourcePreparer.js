

const { EnrichmentManager } = require('../../enrich/enrich');
const { assertTypeEquals } = require('../../utils/assertType');
const { ScopesManager } = require('../security/scopesManager');
const { AccessIndexManager } = require('./accessIndexManager');
const { ResourceManager } = require('./resourceManager');

class ResourcePreparer {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {AccessIndexManager} accessIndexManager
     * @param {EnrichmentManager} enrichmentManager
     * @param {ResourceManager} resourceManager
     */
    constructor ({
                    scopesManager, accessIndexManager,
                    enrichmentManager,
                    resourceManager
                }) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {AccessIndexManager}
         */
        this.accessIndexManager = accessIndexManager;
        assertTypeEquals(accessIndexManager, AccessIndexManager);

        /**
         * @type {EnrichmentManager}
         */
        this.enrichmentManager = enrichmentManager;
        assertTypeEquals(enrichmentManager, EnrichmentManager);

        /**
         * @type {ResourceManager}
         */
        this.resourceManager = resourceManager;
        assertTypeEquals(resourceManager, ResourceManager);
    }

    /**
     * handles selection of specific elements
     * @param {ParsedArgs} parsedArgs
     * @param {Resource} element
     * @param {string} resourceType
     * @return {Resource}
     */
    selectSpecificElements ({ parsedArgs, element, resourceType }) {
        /**
         * @type {string[]|null}
         */
        const properties_to_return_list = parsedArgs.get('_elements').queryParameterValue.values;
        /**
         * @type {Resource}
         */
        const element_to_return = element.create({});
        if (properties_to_return_list) {
            /**
             * @type {string}
             */
            for (const property of properties_to_return_list) {
                if (property in element_to_return) {
                    element_to_return[`${property}`] = element[`${property}`];
                }
            }
        }

        // this is a hack for the CQL Evaluator since it does not request these fields but expects them
        if (resourceType === 'Library') {
            element_to_return.id = element.id;
            element_to_return.url = element.url;
        }
        return element_to_return;
    }

    /**
     * Converts the Mongo document into a document we can return to the client
     * @param {ParsedArgs} parsedArgs
     * @param {Resource} element
     * @param {string} resourceType
     * @returns {Promise<Resource[]>}
     */
    async prepareResourceAsync ({
                                   parsedArgs, element, resourceType
                               }) {
        /**
         * @type {Resource[]}
         */
        let resources = [];
        if (parsedArgs.get('_elements')) {
            /**
             * @type {Resource}
             */
            const element_to_return = this.selectSpecificElements(
                {
                    parsedArgs,
                    element,
                    resourceType
                }
            );
            resources.push(element_to_return);
        } else {
            /**
             * @type {Resource[]}
             */
            const enrichedResources = await this.enrichmentManager.enrichAsync({
                    resources: [element], parsedArgs
                }
            );
            resources = resources.concat(enrichedResources);
        }
        return resources;
    }
}

module.exports = {
    ResourcePreparer
};
