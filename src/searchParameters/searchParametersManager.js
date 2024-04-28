const { assertIsValid } = require('../utils/assertType');
const { SearchParameterDefinition } = require('./searchParameterTypes');

class SearchParametersManager {
    /**
     * constructor
     */
    constructor () {
        /**
         * This are custom search parameters that we support that are not in FHIR standard search parameters
         * @type {{Resource: {extension: SearchParameterDefinition}}}
         */
        const customSearchParameterQueries = {
            Resource: {
                extension: new SearchParameterDefinition({
                    description: 'Extension',
                    type: 'token',
                    field: 'extension'
                })
            },
            SubscriptionStatus: {
                subscription: new SearchParameterDefinition({
                    description: 'Subscription that this status is for',
                    type: 'reference',
                    field: 'subscription',
                    target: ['Subscription']
                })
            }
        };
        /**
         * @type {Record<string, Record<string, SearchParameterDefinition>>}
         */
        this.combinedSearchParameters = {};
        const { searchParameterQueries } = require('./searchParameters');
        // first add any custom search parameters that are missing from standard search parameters
        for (const [resourceType] of Object.entries(customSearchParameterQueries)) {
            const searchParameters = searchParameterQueries[`${resourceType}`];
            if (!searchParameters) {
                searchParameterQueries[`${resourceType}`] = {};
            }
        }
        // combine standard search parameters with custom search parameters
        for (const [resourceType, searchParameters] of Object.entries(searchParameterQueries)) {
            const customSearchParameters = customSearchParameterQueries[`${resourceType}`];
            if (customSearchParameters) {
                this.combinedSearchParameters[resourceType] = { ...searchParameters, ...customSearchParameters };
            } else {
                this.combinedSearchParameters[resourceType] = searchParameters;
            }
        }
    }

    /**
     * returns the search parameters for a given resource type
     * @param {string} resourceType
     * @return {Record<string, SearchParameterDefinition>}
     */
    getSearchParametersForResource ({ resourceType }) {
        assertIsValid(resourceType, 'resourceType is null or undefined');
        const searchParameters = this.combinedSearchParameters[`${resourceType}`];
        return searchParameters;
    }

    /**
     * returns the property object for a given resource type and query parameter
     * @param resourceType
     * @param queryParameter
     * @return {SearchParameterDefinition}
     */
    getPropertyObject ({ resourceType, queryParameter }) {
        /**
         * @type {SearchParameterDefinition}
         */
        let propertyObj;
        /**
         * @type {Record<string, SearchParameterDefinition>}
         */
        const searchParametersForResource = this.getSearchParametersForResource({ resourceType });
        if (searchParametersForResource) {
            propertyObj = searchParametersForResource[`${queryParameter}`];
        }
        if (!propertyObj) {
            const searchParametersInheritedFromResource = this.combinedSearchParameters.Resource[`${queryParameter}`];
            propertyObj = searchParametersInheritedFromResource;
        }
        return propertyObj;
    }

    /**
     * returns all search parameters
     * @return {[string, Record<string, SearchParameterDefinition>][]}
     */
    getAllSearchParameters () {
        return Object.entries(this.combinedSearchParameters);
    }

    /**
     * Returns the field in resource corresponding to search parameter
     * @param {string} searchResourceType
     * @param {string} searchParameterName
     * @returns {string | null}
     */
    getFieldNameForSearchParameter (searchResourceType, searchParameterName) {
        for (const [resourceType, resourceObj] of this.getAllSearchParameters()) {
            if (resourceType === searchResourceType || resourceType === 'Resource') {
                for (const [queryParameter, propertyObj] of Object.entries(resourceObj)) {
                    if (queryParameter === searchParameterName) {
                        return propertyObj.firstField;
                    }
                }
            }
        }
        return null;
    }
}

module.exports = {
    SearchParametersManager
};
