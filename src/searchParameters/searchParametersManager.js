const { assertIsValid } = require('../utils/assertType');
const { SearchParameterDefinition } = require('./searchParameterTypes');

class SearchParametersManager {
    /**
     * constructor
     */
    constructor () {
        /**
         * Custom search parameters that we support that are not in FHIR standard search
         * parameters. Backed by customSearchParameterQueries.json rather than declared inline, so
         * generatorScripts/mcp/generate_mcp_tools.py can read the same file to document these
         * fields on generated MCP tool schemas instead of hand-duplicating them in Python (which
         * previously drifted out of sync -- see that file's load_custom_search_parameters_by_resource).
         * @type {Record<string, Record<string, SearchParameterDefinition>>}
         */
        const customSearchParameterQueries = Object.fromEntries(
            Object.entries(require('./customSearchParameterQueries.json')).map(
                ([resourceType, definitionsByCode]) => [
                    resourceType,
                    Object.fromEntries(
                        Object.entries(definitionsByCode).map(
                            ([code, definition]) => [code, new SearchParameterDefinition(definition)]
                        )
                    )
                ]
            )
        );
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

        /**
         * memoized result of getAllowedFieldsForResource(), keyed by resourceType, search
         * parameter definitions never change at runtime, so this is safe to cache for the
         * lifetime of this (singleton) instance
         * @type {Map<string, Set<string>>}
         */
        this.allowedFieldsForResourceByType = new Map();
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
        // Use hasOwnProperty rather than bare bracket access: the search-parameter maps are plain
        // objects, so a query parameter literally named `constructor`, `toString`, `valueOf`,
        // `hasOwnProperty` etc. would otherwise resolve to the inherited Object.prototype member.
        // That value is truthy, so callers skip their `!propertyObj` unknown-parameter branch and
        // then dereference `propertyObj.fields`, throwing a TypeError -> HTTP 500 on what is really
        // just an unrecognized search parameter.
        if (searchParametersForResource &&
            Object.prototype.hasOwnProperty.call(searchParametersForResource, queryParameter)) {
            propertyObj = searchParametersForResource[`${queryParameter}`];
        }
        if (!propertyObj &&
            this.combinedSearchParameters.Resource &&
            Object.prototype.hasOwnProperty.call(this.combinedSearchParameters.Resource, queryParameter)) {
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
     * Returns every Mongo field path declared on this resource's own search-parameter
     * definitions, plus the generic `Resource` bucket's (the same resourceType-then-Resource
     * fallback rule as getPropertyObject/getFieldNameForSearchParameter, but returning the full
     * set of field paths for a resource instead of looking up one search parameter by name).
     * Memoized per resourceType since these definitions never change at runtime.
     * @param {string} resourceType
     * @return {Set<string>}
     */
    getAllowedFieldsForResource ({ resourceType }) {
        const cached = this.allowedFieldsForResourceByType.get(resourceType);
        if (cached) {
            return cached;
        }
        const allowedFields = new Set();
        for (const searchResourceType of [resourceType, 'Resource']) {
            const searchParametersForResource = this.getSearchParametersForResource({ resourceType: searchResourceType });
            if (searchParametersForResource) {
                for (const propertyObj of Object.values(searchParametersForResource)) {
                    for (const field of propertyObj.fields) {
                        allowedFields.add(field);
                    }
                }
            }
        }
        this.allowedFieldsForResourceByType.set(resourceType, allowedFields);
        return allowedFields;
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
