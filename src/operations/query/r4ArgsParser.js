const {searchParameterQueries} = require('../../searchParameters/searchParameters');
const {STRICT_SEARCH_HANDLING, SPECIFIED_QUERY_PARAMS} = require('../../constants');
const {BadRequestError} = require('../../utils/httpErrors');
const {convertGraphQLParameters} = require('./convertGraphQLParameters');
const {ParsedArgsItem, ParsedArgs} = require('./parsedArgsItem');
const {assertTypeEquals} = require('../../utils/assertType');
const {FhirTypesManager} = require('../../fhir/fhirTypesManager');

/**
 * @classdesc This classes parses an array of args into structured ParsedArgsItem array
 */
class R4ArgsParser {
    /**
     *  constructor
     * @param {FhirTypesManager} fhirTypesManager
     */
    constructor({fhirTypesManager,}) {
        /**
         * @type {FhirTypesManager}
         */
        this.fhirTypesManager = fhirTypesManager;
        assertTypeEquals(fhirTypesManager, FhirTypesManager);
    }

    /**
     * parses args
     * @param {string} resourceType
     * @param {Object} args
     * @return {ParsedArgs}
     */
    parseArgs({resourceType, args}) {
        /**
         * @type {ParsedArgsItem[]}
         */
        const parseArgItems = [];
        // some of these parameters we used wrong in the past but have to map them to maintain backwards compatibility
        // ---- start of backward compatibility mappings ---
        if (args['source'] && !args['_source']) {
            args['_source'] = args['source'];
        }
        if (args['id'] && !args['_id']) {
            args['_id'] = args['id'];
        }
        if (args['id:above'] && !args['_id:above']) {
            args['_id:above'] = args['id:above'];
        }
        if (args['id:below'] && !args['_id:below']) {
            args['_id:below'] = args['id:below'];
        }
        if (args['onset_date'] && !args['onset-date']) {
            args['onset-date'] = args['onset_date'];
        }
        // ---- end of backward compatibility mappings ---

        // ---- start of add range logic to args sent from the search form   ---
        if (args['_lastUpdated'] && Array.isArray(args['_lastUpdated'])) {
            const lastUpdatedArray = args['_lastUpdated'];
            const newUpdatedArray = [];
            lastUpdatedArray.forEach((value, i) => {
                const currentPrefix = value.replace(/[^a-z]/gi, '');
                const newPrefix = i === 0 ? 'gt' : 'lt';
                if (currentPrefix.length === 0 && value !== '') {
                    newUpdatedArray.push(newPrefix + value);
                }
            });
            if (newUpdatedArray.length > 0) {
                args['_lastUpdated'] = newUpdatedArray;
            }
        }
        // ---- end of add range logic to args sent from the search form   ---

        // Represents type of search to be conducted strict or lenient
        const handlingType = args['handling'];
        delete args['handling'];

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

            /**
             * @type {SearchParameterDefinition}
             */
            let propertyObj = searchParameterQueries[`${resourceType}`][`${queryParameter}`];
            if (!propertyObj) {
                propertyObj = searchParameterQueries['Resource'][`${queryParameter}`];
            }
            /**
             * @type {string | string[]}
             */
            let queryParameterValue = args[`${argName}`];
            if (!propertyObj) {
                // In case of an unrecognized argument while searching and handling type is strict throw an error.
                // https://www.hl7.org/fhir/search.html#errors
                if (handlingType === STRICT_SEARCH_HANDLING && SPECIFIED_QUERY_PARAMS.indexOf(queryParameter) === -1) {
                    throw new BadRequestError(new Error(`${queryParameter} is not a parameter for ${resourceType}`));
                }
                parseArgItems.push(
                    new ParsedArgsItem({
                        queryParameter,
                        queryParameterValue,
                        propertyObj,
                        modifiers
                    })
                );
                continue;
            }

            // set type of field in propertyObj
            propertyObj.fieldType = this.fhirTypesManager.getTypeForField(
                {
                    resourceType,
                    field: propertyObj.field
                }
            );
            queryParameterValue = convertGraphQLParameters(
                queryParameterValue,
                args,
                queryParameter
            );

            parseArgItems.push(
                new ParsedArgsItem({
                    queryParameter,
                    queryParameterValue,
                    propertyObj,
                    modifiers
                })
            );

        }

        /**
         * @type {ParsedArgs}
         */
        const parsedArgs = new ParsedArgs(
            {
                base_version: args['base_version'],
                parsedArgItems: parseArgItems
            }
        );
        return parsedArgs;
    }
}

module.exports = {
    R4ArgsParser
};
