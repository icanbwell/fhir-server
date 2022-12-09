const {EnrichmentManager} = require('../../enrich/enrich');
const {assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('../security/scopesManager');
const {AccessIndexManager} = require('./accessIndexManager');
const {ResourceManager} = require('./resourceManager');

class ResourcePreparer {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     * @param {AccessIndexManager} accessIndexManager
     * @param {EnrichmentManager} enrichmentManager
     * @param {ResourceManager} resourceManager
     */
    constructor({
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
     * @param {Object} args
     * @param {Resource} element
     * @param {string} resourceType
     * @return {Resource}
     */
    selectSpecificElements({args, element, resourceType}) {
        /**
         * @type {string}
         */
        const properties_to_return_as_csv = args['_elements'];
        /**
         * @type {string[]}
         */
        const properties_to_return_list = properties_to_return_as_csv.split(',');
        /**
         * @type {Resource}
         */
        const element_to_return = element.create({});
        /**
         * @type {string}
         */
        for (const property of properties_to_return_list) {
            if (property in element_to_return) {
                element_to_return[`${property}`] = element[`${property}`];
            }
        }
        // this is a hack for the CQL Evaluator since it does not request these fields but expects them
        if (resourceType === 'Library') {
            element_to_return['id'] = element['id'];
            element_to_return['url'] = element['url'];
        }
        return element_to_return;
    }

    /**
     * Converts the Mongo document into a document we can return to the client
     * @param {string | null} user
     * @param {string | null} scope
     * @param {Object} args
     * @param {Resource} element
     * @param {string} resourceType
     * @param {boolean} useAccessIndex
     * @param {Object} originalArgs
     * @returns {Promise<Resource[]>}
     */
    async prepareResourceAsync({
                                   user, scope, args,
                                   element, resourceType, useAccessIndex,
                                   originalArgs
                               }) {
        /**
         * @type {Resource[]}
         */
        let resources = [];
        if (args['_elements']) {
            if (!useAccessIndex || !this.accessIndexManager.resourceHasAccessIndex({resourceType})) {
                // if the whole resource is returned then we have security tags to check again to be double sure
                if (!this.scopesManager.isAccessToResourceAllowedBySecurityTags(
                    {
                        resource: element, user, scope
                    }
                )
                ) {
                    return [];
                }
            }
            /**
             * @type {Resource}
             */
            const element_to_return = this.selectSpecificElements(
                {
                    args,
                    element,
                    resourceType
                }
            );
            resources.push(element_to_return);
        } else {
            // if the whole resource is returned then we have security tags to check again to be double sure
            if (!this.scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: element, user, scope
            })) {
                return [];
            }
            /**
             * @type {Resource[]}
             */
            const enrichedResources = await this.enrichmentManager.enrichAsync({
                    resources: [element], args, originalArgs
                }
            );
            resources = resources.concat(enrichedResources);
        }
        resources = this.resourceManager.removeDuplicateResources({resources});
        return resources;
    }
}

module.exports = {
    ResourcePreparer
};
