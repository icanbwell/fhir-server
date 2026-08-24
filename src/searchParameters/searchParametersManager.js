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
            },
            ExportStatus: {
                status: new SearchParameterDefinition({
                    description: 'The status for ExportStatus',
                    type: 'token',
                    field: 'status'
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

        /**
         * memoized result of getAllowedFieldsForResource(), keyed by resourceType, search
         * parameter definitions never change at runtime, so this is safe to cache for the
         * lifetime of this (singleton) instance
         * @type {Map<string, Map<string, string | null>>}
         */
        this.allowedFieldsByResourceType = new Map();
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
     * Walks every search parameter declared for a resourceType, plus the generic `Resource`
     * bucket (same resourceType-then-Resource fallback rule as getPropertyObject/
     * getFieldNameForSearchParameter), building a single Map keyed by every allowed Mongo field
     * path for that resourceType. A key's mere presence (checked via .has()) is what makes that
     * field an allowed sort field, independent of its value; the value (read via .get()) is that
     * field's declared FHIR type (e.g. 'period', 'datetime'), or null when no type was declared.
     * This is the one source both callers wanting the allowed field names (via .keys(), e.g.
     * SearchManager.getAllowedSortFields) and getFieldType (via .get()) read from, so the walk
     * happens once per resourceType. A field already resolved to a real type is never
     * overwritten by a later untyped occurrence of the same field name, regardless of which
     * bucket/search-parameter is walked first. Memoized per resourceType since these definitions
     * never change at runtime.
     * @param {string} resourceType
     * @return {Map<string, string | null>}
     */
    getAllowedFieldsForResource ({ resourceType }) {
        const cached = this.allowedFieldsByResourceType.get(resourceType);
        if (cached) {
            return cached;
        }
        const allowedFields = new Map();
        for (const resourceTypeBucket of [resourceType, 'Resource']) {
            const searchParametersForResource = this.getSearchParametersForResource({ resourceType: resourceTypeBucket });
            if (searchParametersForResource) {
                for (const propertyObj of Object.values(searchParametersForResource)) {
                    for (const field of propertyObj.fields) {
                        if (!allowedFields.get(field)) {
                            allowedFields.set(field, (propertyObj.fieldTypesObj && propertyObj.fieldTypesObj[field]) || null);
                        }
                    }
                }
            }
        }
        this.allowedFieldsByResourceType.set(resourceType, allowedFields);
        return allowedFields;
    }

    /**
     * Returns the FHIR field type (e.g. 'period', 'datetime', 'instant') declared for a Mongo
     * field path on a resourceType. This lets callers recognize e.g. any Period-typed field
     * generically (a `<field>.start`/`<field>.end` _sort target) without needing a dedicated
     * search parameter declared per field.
     * @param {string} resourceType
     * @param {string} field
     * @return {string | null}
     */
    getFieldType ({ resourceType, field }) {
        return this.getAllowedFieldsForResource({ resourceType }).get(field) || null;
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
