const { EnrichmentManager } = require('../../enrich/enrich');
const { IdentifierEnrichmentProvider } = require('../../enrich/providers/identifierEnrichmentProvider');
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
     * @param {IdentifierEnrichmentProvider} identifierEnrichmentProvider
     */
    constructor({
        scopesManager,
        accessIndexManager,
        enrichmentManager,
        resourceManager,
        identifierEnrichmentProvider
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

        /**
         * @type {IdentifierEnrichmentProvider}
         */
        this.identifierEnrichmentProvider = identifierEnrichmentProvider;
        assertTypeEquals(identifierEnrichmentProvider, IdentifierEnrichmentProvider);
    }

    /**
     * handles selection of specific elements
     * @param {ParsedArgs} parsedArgs
     * @param {Resource} element
     * @param {string} resourceType
     * @return {Resource}
     */
    selectSpecificElements({ parsedArgs, element, resourceType }) {
        /**
         * @type {string[]|null}
         */
        const properties_to_return_list = parsedArgs.get('_elements').queryParameterValue.values;
        properties_to_return_list.push('resourceType');

        if (properties_to_return_list.includes('identifier')) {
            this.identifierEnrichmentProvider.enrichIdentifierList(element);
        }

        let element_to_return = Object.keys(element)
            .filter((key) => properties_to_return_list.includes(key))
            .reduce((acc, key) => {
                acc[key] = element[key];
                return acc;
            }, {});

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
    async prepareResourceAsync({ parsedArgs, element, resourceType }) {
        if (parsedArgs.get('_elements') && !parsedArgs.get('_isGraphQLRequest')) {
            /**
             * @type {Resource}
             */
            element = this.selectSpecificElements({
                parsedArgs,
                element,
                resourceType
            });
        }
        if (!parsedArgs.get('_elements') || parsedArgs.get('_isGraphQLRequest')) {
            /**
             * @type {Resource[]}
             */
            [element] = await this.enrichmentManager.enrichAsync({
                resources: [element],
                parsedArgs
            });
        }
        return [element];
    }
}

module.exports = {
    ResourcePreparer
};
