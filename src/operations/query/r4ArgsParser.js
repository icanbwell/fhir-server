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
 * @param {*} value
 * @return {boolean} whether MongoDB would read this as an operator expression (`{ $gt: '' }`)
 */
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Removes values MongoDB would interpret as operator expressions. A POST _search body of
 * `url[$gt]=` parses into { $gt: '' } and `url[0][$gt]=` into [{ $gt: '' }].
 *
 * Returning undefined makes the caller's emptiness checks skip the parameter entirely, so
 * no ParsedArgsItem is created -- matching an equivalent GET, and avoiding filters that
 * dereference the value without a null guard (e.g. FilterByDateTime).
 * @param {*} value
 * @return {*} the value with operator objects removed, or undefined if nothing is left
 */
const stripOperatorObjects = (value) => {
    if (isPlainObject(value)) {
        return undefined;
    }
    // only rewrite when an object is actually present, so other inputs notably an
    // already-empty array -- keep their existing semantics
    if (Array.isArray(value) && value.some(isPlainObject)) {
        const scalars = value.filter(v => !isPlainObject(v));
        return scalars.length > 0 ? scalars : undefined;
    }
    return value;
};

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
            if (queryParameter === '_elements' && queryParameterValue) {
                const queryParameterList = Array.isArray(queryParameterValue)
                    ? queryParameterValue
                    : queryParameterValue.split(',').map((param) => param.trim());
                if (!queryParameterList.includes(this.configManager.defaultSortId)) {
                    queryParameterList.push(this.configManager.defaultSortId);
                }
                if (queryParameterList.includes('identifier')) {
                    // if identifier is requested then also request the _uuid and _sourceId fields
                    // since they are needed to populate the identifier system and value
                    if (!queryParameterList.includes('_uuid')) {
                        queryParameterList.push('_uuid');
                    }
                    if (!queryParameterList.includes('_sourceId')) {
                        queryParameterList.push('_sourceId');
                    }
                }
                queryParameterValue = queryParameterList.join(',');
            }
            if (!propertyObj) {
                // In case of an unrecognized argument while searching and handling type is strict throw an error.
                // https://www.hl7.org/fhir/search.html#errors
                if (handlingType === STRICT_SEARCH_HANDLING && SPECIFIED_QUERY_PARAMS.indexOf(queryParameter) === -1) {
                    throw new BadRequestError(new Error(`${queryParameter} is not a parameter for ${resourceType}`));
                }
                // Deliberately not stripping operator objects here: these items have no
                // propertyObj, and r4.js only builds a filter when propertyObj is set, so they
                // never reach the mongo query. Some are legitimately objects -- $graph reads a
                // GraphDefinition off parsedArgs.resource / parsedArgs.graph.
                if (
                    (typeof queryParameterValue !== 'undefined'
                        && queryParameterValue !== null
                        && queryParameterValue !== '') && (
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

            let orQueryParameterValue, andQueryParameterValue, notQueryParameterValue, newModifiers = [];
            ({ orQueryParameterValue, andQueryParameterValue, notQueryParameterValue, newModifiers } = convertGraphQLParameters(
                queryParameterValue
            ));

            // Must run after the GraphQL conversion: GraphQL legitimately supplies objects
            // (identified by `searchType`) which convertGraphQLParameters turns into strings.
            // Anything still an object here came straight from a request body.
            orQueryParameterValue = stripOperatorObjects(orQueryParameterValue);
            notQueryParameterValue = stripOperatorObjects(notQueryParameterValue);

            // Keep the pre-concat modifiers (from the colon-suffixed argName) separately: newModifiers
            // (e.g. 'contains', 'exact', 'missing') describes orQueryParameterValue/andQueryParameterValue,
            // not notQueryParameterValue, since convertGraphQLParameters returns them from the same call
            // with no way to tell them apart. Applying newModifiers to the not-item below as well would
            // route its value through the wrong filter (e.g. 'missing' forcing it through FilterByMissing).
            const preConvertModifiers = modifiers;

            if (newModifiers && Array.isArray(newModifiers) && newModifiers.length) {
                modifiers = modifiers.concat(newModifiers);
            }

            if (typeof orQueryParameterValue !== 'undefined' &&
                    orQueryParameterValue !== null &&
                    orQueryParameterValue !== '' && (
                    !Array.isArray(orQueryParameterValue) ||
                    orQueryParameterValue.filter(v => v).length > 0
                )
            ) {
                parseArgItems.push(
                    new ParsedArgsItem({
                        queryParameter,
                        queryParameterValue: new QueryParameterValue({
                            value: orQueryParameterValue,
                            operator: useOrFilterForArrays ? '$or' : '$and'
                        }),
                        propertyObj,
                        modifiers
                    })
                );
            }

            if (typeof andQueryParameterValue !== 'undefined' &&
                andQueryParameterValue !== null &&
                andQueryParameterValue !== '' &&
                Array.isArray(andQueryParameterValue) &&
                andQueryParameterValue.length > 0
            ) {
                andQueryParameterValue.forEach(innerList => {
                    if (Array.isArray(innerList) && innerList.length > 0) {
                        parseArgItems.push(
                            new ParsedArgsItem({
                                queryParameter,
                                queryParameterValue: new QueryParameterValue({
                                    value: innerList,
                                    operator: '$and'
                                }),
                                propertyObj,
                                modifiers
                            })
                        );
                    }
                });
            }

            if (typeof notQueryParameterValue !== 'undefined' &&
                    notQueryParameterValue !== null &&
                    notQueryParameterValue !== '' && (
                    !Array.isArray(notQueryParameterValue) ||
                    notQueryParameterValue.filter(v => v).length > 0
                )
            ) {
                const notModifiers = deepcopy(preConvertModifiers);
                notModifiers.push('not');
                parseArgItems.push(
                    new ParsedArgsItem({
                        queryParameter,
                        queryParameterValue: new QueryParameterValue({
                            value: notQueryParameterValue,
                            operator: useOrFilterForArrays ? '$or' : '$and'
                        }),
                        propertyObj,
                        modifiers: notModifiers
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

module.exports = {
    R4ArgsParser
};
