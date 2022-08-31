const {enrich} = require('../../enrich/enrich');
const {resourceHasAccessIndex} = require('./resourceHasAccessIndex');
const {assertTypeEquals} = require('../../utils/assertType');
const {ScopesManager} = require('../security/scopesManager');

class ResourcePreparer {
    /**
     * constructor
     * @param {ScopesManager} scopesManager
     */
    constructor({scopesManager}) {
        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
    }

    /**
     * handles selection of specific elements
     * @param {Object} args
     * @param {function(?Object): Resource} Resource
     * @param {Resource} element
     * @param {string} resourceType
     * @return {Resource}
     */
    selectSpecificElements(args, Resource, element, resourceType) {
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
        const element_to_return = new Resource(null);
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
     * @param {function(?Object): Resource} ResourceCreator
     * @param {Resource} element
     * @param {string} resourceType
     * @param {boolean} useAccessIndex
     * @returns {Promise<Resource[]>}
     */
    async prepareResourceAsync(user, scope, args,
                               ResourceCreator, element, resourceType, useAccessIndex) {
        let resources = [];
        if (args['_elements']) {
            if (!useAccessIndex || !resourceHasAccessIndex(resourceType)) {
                // if the whole resource is returned then we have security tags to check again to be double sure
                if (!this.scopesManager.isAccessToResourceAllowedBySecurityTags(element, user, scope)) {
                    return [];
                }
            }

            const element_to_return = this.selectSpecificElements(
                args,
                ResourceCreator,
                element,
                resourceType
            );
            resources.push(element_to_return);
        } else {
            // if the whole resource is returned then we have security tags to check again to be double sure
            if (!this.scopesManager.isAccessToResourceAllowedBySecurityTags(element, user, scope)) {
                return [];
            }
            /**
             * @type  {Resource}
             */
            const resource = new ResourceCreator(element);
            /**
             * @type {Resource[]}
             */
            const enrichedResources = await enrich([resource], resourceType);
            resources = resources.concat(enrichedResources);
        }
        return resources;
    }
}

module.exports = {
    ResourcePreparer
};
