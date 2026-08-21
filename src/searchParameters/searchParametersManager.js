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
        /**
         * memoized result of getFieldType(), keyed by resourceType then by field path, search
         * parameter definitions never change at runtime, so this is safe to cache for the
         * lifetime of this (singleton) instance
         * @type {Map<string, Map<string, string>>}
         */
        this.fieldTypesByResourceType = new Map();
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
     * Returns the FHIR field type (e.g. 'period', 'datetime', 'instant') declared for a Mongo
     * field path on a resourceType, by scanning every search parameter's fieldTypesObj for that
     * resourceType plus the generic Resource bucket (same resourceType-then-Resource fallback
     * rule as getAllowedFieldsForResource). This lets callers recognize e.g. any Period-typed
     * field generically (a `<field>.start`/`<field>.end` _sort target) without needing a
     * dedicated search parameter declared per field. Memoized per resourceType since these
     * definitions never change at runtime.
     * @param {string} resourceType
     * @param {string} field
     * @return {string | null}
     */
    getFieldType ({ resourceType, field }) {
        let fieldTypes = this.fieldTypesByResourceType.get(resourceType);
        if (!fieldTypes) {
            fieldTypes = new Map();
            for (const searchResourceType of [resourceType, 'Resource']) {
                const searchParametersForResource = this.getSearchParametersForResource({ resourceType: searchResourceType });
                if (searchParametersForResource) {
                    for (const propertyObj of Object.values(searchParametersForResource)) {
                        for (const [fieldName, fieldType] of Object.entries(propertyObj.fieldTypesObj || {})) {
                            if (!fieldTypes.has(fieldName)) {
                                fieldTypes.set(fieldName, fieldType);
                            }
                        }
                    }
                }
            }
            this.fieldTypesByResourceType.set(resourceType, fieldTypes);
        }
        return fieldTypes.get(field) || null;
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
