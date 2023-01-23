const {searchParameterQueries} = require('../../searchParameters/searchParameters');
const {STRICT_SEARCH_HANDLING, SPECIFIED_QUERY_PARAMS} = require('../../constants');
const {BadRequestError} = require('../../utils/httpErrors');
const {convertGraphQLParameters} = require('./convertGraphQLParameters');
const {ParsedArgsItem, ParsedReferenceItem} = require('./parsedArgsItem');
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
     * @return {ParsedArgsItem[]}
     */
    parseArgs({resourceType, args}) {

        /**
         * @type {ParsedArgsItem[]}
         */
        const parsedArgs = [];
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
            const [queryParameter, ...modifiers] = argName.split(':');
            /**
             * @type {SearchParameterDefinition}
             */
            let propertyObj = searchParameterQueries[`${resourceType}`][`${queryParameter}`];
            if (!propertyObj) {
                propertyObj = searchParameterQueries['Resource'][`${queryParameter}`];
            }
            if (!propertyObj) {
                // In case of an unrecognized argument while searching and handling type is strict throw an error.
                // https://www.hl7.org/fhir/search.html#errors
                if (handlingType === STRICT_SEARCH_HANDLING && SPECIFIED_QUERY_PARAMS.indexOf(queryParameter) === -1) {
                    throw new BadRequestError(new Error(`${queryParameter} is not a parameter for ${resourceType}`));
                }
                continue;
            }

            // set type of field in propertyObj
            propertyObj.fieldType = this.fhirTypesManager.getTypeForField(
                {
                    resourceType,
                    field: propertyObj.field
                }
            );
            /**
             * @type {string | string[]}
             */
            let queryParameterValue = args[`${argName}`];
            queryParameterValue = convertGraphQLParameters(
                queryParameterValue,
                args,
                queryParameter
            );

            if (queryParameterValue) {
                parsedArgs.push(
                    new ParsedArgsItem({
                        queryParameter,
                        queryParameterValue,
                        propertyObj,
                        modifiers,
                        references: (propertyObj.type === 'reference') ?
                            this.parseQueryParameterValueIntoReferences(
                                {
                                    queryParameterValue,
                                    propertyObj
                                }
                            ) : undefined
                    })
                );
            }
        }
        return parsedArgs;
    }

    /**
     * parses a query parameter value for reference into resourceType, id
     * @param {string|string[]} queryParameterValue
     * @param {SearchParameterDefinition} propertyObj
     * @return {ParsedReferenceItem[]}
     */
    parseQueryParameterValueIntoReferences({queryParameterValue, propertyObj}) {
        /**
         * @type {ParsedReferenceItem[]}
         */
        const result = [];
        queryParameterValue = Array.isArray(queryParameterValue) ? queryParameterValue : [queryParameterValue];
        // The forms are:
        // 1. Patient/123,456
        // 2. 123,456
        // 3. Patient/123, Patient/456
        /**
         * @type {string|null}
         */
        let resourceType = null;
        for (const /** @type {string} */ val of queryParameterValue) {
            const valueParts = val.split('/');
            /**
             * @type {string}
             */
            let id;
            if (valueParts.length > 1) {
                resourceType = valueParts[0];
                id = valueParts[1];
            } else {
                id = valueParts[0];
            }
            if (resourceType) {
                // resource type was specified
                result.push(
                    new ParsedReferenceItem({
                        resourceType,
                        id
                    })
                );
            } else {
                for (const target of propertyObj.target) {
                    result.push(
                        new ParsedReferenceItem({
                           resourceType: target,
                            id
                        })
                    );
                }
            }
        }

        return result;
    }
}

module.exports = {
    R4ArgsParser
};
