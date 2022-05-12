const {isAccessToResourceAllowedBySecurityTags} = require('../security/scopes');
const {removeNull} = require('../../utils/nullRemover');
const {enrich} = require('../../enrich/enrich');

/**
 * handles selection of specific elements
 * @param {Object} args
 * @param {function(?Object): Resource} Resource
 * @param {Resource} element
 * @param {string} resourceName
 * @return {Resource}
 */
function selectSpecificElements(args, Resource, element, resourceName) {
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
    if (resourceName === 'Library') {
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
 * @param {Function} Resource
 * @param {Resource} element
 * @param {string} resourceName
 * @returns {Promise<Resource[]>}
 */
async function prepareResourceAsync(user, scope, args, Resource, element, resourceName) {
    let resources = [];
    if (!isAccessToResourceAllowedBySecurityTags(element, user, scope)) {
        return [];
    }
    if (args['_elements']) {
        const element_to_return = selectSpecificElements(
            args,
            Resource,
            element,
            resourceName
        );
        resources.push(element_to_return);
    } else {
        /**
         * @type  {Resource}
         */
        const resource = new Resource(element);
        /**
         * @type {Object}
         */
        const cleanResource = removeNull(resource.toJSON());
        /**
         * @type {Resource[]}
         */
        const enrichedResources = await enrich([cleanResource], resourceName);
        resources = resources.concat(enrichedResources);
    }
    return resources;
}

module.exports = {
    prepareResourceAsync: prepareResourceAsync,
};
