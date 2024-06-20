const deepcopy = require('deepcopy');
const { STRICT_SEARCH_HANDLING, SPECIFIED_QUERY_PARAMS } = require('../../constants');
const { BadRequestError } = require('../../utils/httpErrors');
const { convertGraphQLParameters } = require('./convertGraphQLParameters');
const { ParsedArgsItem } = require('./parsedArgsItem');
const { assertTypeEquals } = require('../../utils/assertType');
const { FhirTypesManager } = require('../../fhir/fhirTypesManager');
const { QueryParameterValue } = require('./queryParameterValue');
const { ParsedArgs } = require('./parsedArgs');
const { ConfigManager } = require('../../utils/configManager');
const { SearchParametersManager } = require('../../searchParameters/searchParametersManager');

/**
 * @classdesc This classes parses an array of args into structured ParsedArgsItem array
 */
class R4ArgsParser {
    /**
     *  constructor
     * @param {FhirTypesManager} fhirTypesManager
     * @param {ConfigManager} configManager
     * @param {SearchParametersManager} searchParametersManager
     */
    constructor ({ fhirTypesManager, configManager, searchParametersManager }) {
        /**
         * @type {FhirTypesManager}
         */
        this.fhirTypesManager = fhirTypesManager;
        assertTypeEquals(fhirTypesManager, FhirTypesManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {SearchParametersManager}
         */
        this.searchParametersManager = searchParametersManager;
        assertTypeEquals(searchParametersManager, SearchParametersManager);
    }

    /**
     * parses args
     * @param {string} resourceType
     * @param {Object} args
     * @param {boolean|undefined} [useOrFilterForArrays]  whether to use OR filters for arrays
     * @return {ParsedArgs}
     */
    parseArgs ({ resourceType, args, useOrFilterForArrays }) {
        /**
         * @type {ParsedArgsItem[]}
         */
        const parseArgItems = [];
        // some of these parameters we used wrong in the past but have to map them to maintain backwards compatibility
        // ---- start of backward compatibility mappings ---
        if (args.source && !args._source) {
            args._source = args.source;
        }
        if (args.id && !args._id) {
            args._id = args.id;
        }
        if (args['id:above'] && !args['_id:above']) {
            args['_id:above'] = args['id:above'];
        }
        if (args['id:below'] && !args['_id:below']) {
            args['_id:below'] = args['id:below'];
        }
        if (args.onset_date && !args['onset-date']) {
            args['onset-date'] = args.onset_date;
        }
        // ---- end of backward compatibility mappings ---

        // ---- start of add range logic to args sent from the search form   ---
        if (args._lastUpdated && Array.isArray(args._lastUpdated)) {
            const lastUpdatedArray = args._lastUpdated;
            const newUpdatedArray = [];
            lastUpdatedArray.forEach((value, i) => {
                const currentPrefix = value.replace(/[^a-z]/gi, '');
                const newPrefix = i === 0 ? 'gt' : 'lt';
                if (currentPrefix.length === 0 && value !== '') {
                    newUpdatedArray.push(newPrefix + value);
                }
            });
            if (newUpdatedArray.length > 0) {
                args._lastUpdated = newUpdatedArray;
            }
        }
        // ---- end of add range logic to args sent from the search form   ---

        // Represents type of search to be conducted strict or lenient
        const handlingType = args.handling;
        delete args.handling;

        for (const argName in args) {
            let [queryParameter, ...modifiers] = argName.split(':');
            // ---- start of backward compatibility mappings ---
            if (queryParameter === 'source') {
                queryParameter = '_source';
            }
            if (queryParameter === 'id') {
                queryParameter = '_id';
            }
            if (queryParameter === 'onset_date') {
                queryParameter = 'onset-date';
            }
            // ---- end of backward compatibility mappings ---

            // graphql search parameters cannot use '-', so do not match standard search parameters. This changes
            // them to standard
            if (!queryParameter.startsWith('_') && queryParameter !== 'base_version' && queryParameter !== 'version_id') {
                queryParameter = queryParameter.replace('_', '-');
            }
            /**
             * @type {SearchParameterDefinition}
             */
            const propertyObj = this.searchParametersManager.getPropertyObject(
                {
                    resourceType,
                    queryParameter
                }
            );
            /**
             * @type {string | string[]}
             */
            let queryParameterValue = args[`${argName}`];
            // if _elements parameter is passed we should also fetch _uuid to generate the nextLink if not present already
            if (queryParameter === '_elements' && queryParameterValue && !queryParameterValue.includes(this.configManager.defaultSortId)) {
                queryParameterValue += `,${this.configManager.defaultSortId}`;
            }
            if (!propertyObj) {
                // In case of an unrecognized argument while searching and handling type is strict throw an error.
                // https://www.hl7.org/fhir/search.html#errors
                if (handlingType === STRICT_SEARCH_HANDLING && SPECIFIED_QUERY_PARAMS.indexOf(queryParameter) === -1) {
                    throw new BadRequestError(new Error(`${queryParameter} is not a parameter for ${resourceType}`));
                }
                if (
                    (queryParameterValue && queryParameterValue !== '') && (
                        !Array.isArray(queryParameterValue) || queryParameterValue.filter(v => v).length > 0
                    )
                ) {
                    parseArgItems.push(
                        new ParsedArgsItem({
                            queryParameter,
                            queryParameterValue: new QueryParameterValue({
                                value: queryParameterValue,
                                operator: useOrFilterForArrays ? '$or' : '$and'
                            }),
                            propertyObj,
                            modifiers
                        })
                    );
                }
                continue;
            }

            // set type of field in propertyObj
            propertyObj.fieldType = propertyObj.fields.length > 0
                ? this.fhirTypesManager.getTypeForField(
                    {
                        resourceType,
                        field: propertyObj.firstField
                    }
                ) : null;

            let notQueryParameterValue;

            // Splitting the given query parameter value to be considered separately
            const splitQueries = splitQuery(queryParameterValue);
            splitQueries.forEach((graphqlQuery)=>{
                const originalGraphQLQuery = deepcopy(graphqlQuery);
                ({ queryParameterValue, notQueryParameterValue } = convertGraphQLParameters(graphqlQuery));

                if (queryParameterValue && (
                        !Array.isArray(queryParameterValue) ||
                        queryParameterValue.filter(v => v).length > 0
                    )
                ) {
                    const newModifiers = deepcopy(modifiers);
                    const modifier = findModifier(originalGraphQLQuery);
                    if (modifier) {
                        newModifiers.push(modifier);
                    }
                    parseArgItems.push(
                        new ParsedArgsItem({
                            queryParameter,
                            queryParameterValue: new QueryParameterValue({
                                value: queryParameterValue,
                                operator: useOrFilterForArrays ? '$or' : '$and'
                            }),
                            propertyObj,
                            modifiers: newModifiers
                        })
                    );
                }

                if (notQueryParameterValue && (
                        !Array.isArray(notQueryParameterValue) ||
                        notQueryParameterValue.filter(v => v).length > 0
                    )
                ) {
                    const newModifiers = deepcopy(modifiers);
                    newModifiers.push('not');
                    parseArgItems.push(
                        new ParsedArgsItem({
                            queryParameter,
                            queryParameterValue: new QueryParameterValue({
                                value: notQueryParameterValue,
                                operator: useOrFilterForArrays ? '$or' : '$and'
                            }),
                            propertyObj,
                            modifiers: newModifiers
                        })
                    );
                }
                queryParameterValue = null;
            });

            if (queryParameterValue && (
                !Array.isArray(queryParameterValue) ||
                queryParameterValue.filter(v => v).length > 0
            )
            ) {
                parseArgItems.push(
                    new ParsedArgsItem({
                        queryParameter,
                        queryParameterValue: new QueryParameterValue({
                            value: queryParameterValue,
                            operator: useOrFilterForArrays ? '$or' : '$and'
                        }),
                        propertyObj,
                        modifiers
                    })
                );
            }
        }
        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = new ParsedArgs(
            {
                base_version: args.base_version,
                parsedArgItems: parseArgItems
            }
        );
        return parsedArgs;
    }
}

/**
 * Splits a query object into multiple queries based on its properties.
 *
 * @param {Object} query - The query object to split.
 * @returns {Array} - An array of query objects.
 */
function splitQuery(query) {
    const queries = [];
    let keys = ["value", "values", "missing", "target", "notEquals", "prefix"];

    // Ensure query is an object and not null or undefined
    if (query && typeof query === 'object') {
        // Case for reference where target and value are to be considered together
        if (query.target && query.value) {
            queries.push({
                searchType: query.searchType,
                target: query.target,
                value: query.value
            });
            keys = keys.filter(key => key !== "value" && key !== "target");
        }
        keys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(query, key)) {
                queries.push({
                    searchType: query.searchType,
                    [key]: query[key]
                });
            }
        });
    }

    return queries;
}


/**
 * Finds and returns the first key in the query object that matches one of the specified modifiers.
 *
 * @param {Object} query - The query object to search for modifiers.
 * @returns {string|undefined} - The name of the first matching key if found, otherwise undefined.
 */
function findModifier(query) {
    const keys = ["value", "missing", "prefix", "target"];
    for (const key of keys) {
        if (key in query) {
            return key;
        }
    }
}

module.exports = {
    R4ArgsParser
};
