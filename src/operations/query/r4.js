const {fhirFilterTypes} = require('./customQueries');
const {searchParameterQueries} = require('../../searchParameters/searchParameters');
const {SPECIFIED_QUERY_PARAMS} = require('../../constants');
const {filterById} = require('./filters/id');
const {filterByString} = require('./filters/string');
const {filterByUri} = require('./filters/uri');
const {filterByDateTime} = require('./filters/dateTime');
const {filterByToken} = require('./filters/token');
const {filterByReference} = require('./filters/reference');
const {filterByMissing} = require('./filters/missing');
const {filterByContains} = require('./filters/contains');
const {filterByAbove, filterByBelow} = require('./filters/aboveAndBelow');
const {convertGraphQLParameters} = require('./convertGraphQLParameters');
const {filterByPartialText} = require('./filters/partialText');
const {filterByCanonical} = require('./filters/canonical');
const {filterBySecurityTag} = require('./filters/securityTag');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {AccessIndexManager} = require('../common/accessIndexManager');
const {FhirTypesManager} = require('../../fhir/fhirTypesManager');
const {NotFoundError} = require('../../utils/httpErrors');

function isUrl(queryParameterValue) {
    return typeof queryParameterValue === 'string' &&
        (
            queryParameterValue.startsWith('http://') ||
            queryParameterValue.startsWith('https://') ||
            queryParameterValue.startsWith('ftp://')
        );
}

class R4SearchQueryCreator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     * @param {AccessIndexManager} accessIndexManager
     * @param {FhirTypesManager} fhirTypesManager
     */
    constructor({
                    configManager,
                    accessIndexManager,
                    fhirTypesManager
                }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {AccessIndexManager}
         */
        this.accessIndexManager = accessIndexManager;
        assertTypeEquals(accessIndexManager, AccessIndexManager);
        /**
         * @type {FhirTypesManager}
         */
        this.fhirTypesManager = fhirTypesManager;
        assertTypeEquals(fhirTypesManager, FhirTypesManager);
    }

    /**
     * Builds a mongo query for search parameters
     * @param {string} resourceType
     * @param {Object} args
     * @returns {{query:import('mongodb').Document, columns: Set}} A query object to use with Mongo
     */
    buildR4SearchQuery({resourceType, args}) {
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

        /**
         * list of columns used in the query
         * this is used to pick index hints
         * @type {Set}
         */
        let totalColumns = new Set();
        /**
         * and segments
         * these are combined to create the query
         * @type {Object[]}
         */
        let totalAndSegments = [];

        const specifiedQueryParams = SPECIFIED_QUERY_PARAMS;
        for (const argName in args) {
            const [queryParameter, ...modifiers] = argName.split(':');

            let propertyObj = searchParameterQueries[`${resourceType}`][`${queryParameter}`];
            if (!propertyObj) {
                propertyObj = searchParameterQueries['Resource'][`${queryParameter}`];
            }
            if (!propertyObj) {
                // ignore this unrecognized arg
                if (specifiedQueryParams.indexOf(argName) === -1) {
                    throw new NotFoundError(`${queryParameter} is not a parameter for ${resourceType}`);
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

                let {columns, andSegments} = this.getColumnsAndSegmentsForParameterType({
                    resourceType, queryParameter, queryParameterValue, propertyObj
                });

                // replace andSegments according to modifiers
                if (modifiers.includes('missing')) {
                    andSegments = filterByMissing({
                        args, queryParameter, propertyObj, columns
                    });
                } else if (modifiers.includes('contains')) {
                    andSegments = filterByContains({
                        propertyObj, queryParameterValue, columns
                    });
                } else if (modifiers.includes('above')) {
                    andSegments = filterByAbove({
                        propertyObj, queryParameterValue, columns
                    });
                } else if (modifiers.includes('below')) {
                    andSegments = filterByBelow({
                        propertyObj, queryParameterValue, columns
                    });
                } else if (modifiers.includes('text')) {
                    columns = new Set(); // text overrides datatype column logic
                    andSegments = filterByPartialText({
                        args, queryParameter, propertyObj, columns,
                    });
                }

                // apply negation according to not modifier and add to final collection
                if (modifiers.includes('not')) {
                    andSegments.forEach(q => totalAndSegments.push({$nor: [q]}));
                } else {
                    andSegments.forEach(q => totalAndSegments.push(q));
                }

                for (const column of columns) {
                    totalColumns.add(column);
                }
            }
        }

        /**
         * query to run on mongo
         * @type {{$and: Object[]}}
         */
        let query = {};

        if (totalAndSegments.length !== 0) {
            // noinspection JSUndefinedPropertyAssignment
            query.$and = totalAndSegments;
        }

        return {
            query: query,
            columns: totalColumns,
        };
    }

    /**
     * Builds a set of columns and list of segments to apply for a particular query parameter
     * @param {string} resourceType
     * @param {string} queryParameter
     * @param {string} queryParameterValue
     * @param {Object} propertyObj
     * @returns {{columns: Set, andSegments: Object[]}} columns and andSegments for query parameter
     */
    getColumnsAndSegmentsForParameterType({resourceType, queryParameter, queryParameterValue, propertyObj}) {
        /**
         * list of columns used in the query for this parameter
         * this is used to pick index hints
         * @type {Set}
         */
        let columns = new Set();

        /**
         * and segments
         * these are combined to create the query
         * @type {Object[]}
         */
        let andSegments = [];


        // get the set of columns required for the query
        if (queryParameter === '_id') {
            // handle id differently since it is a token, but we want to do exact match
            andSegments = filterById({
                queryParameterValue, propertyObj, columns
            });
        } else {
            switch (propertyObj.type) {
                case fhirFilterTypes.string:
                    andSegments = filterByString({
                        queryParameterValue, propertyObj, columns
                    });
                    break;
                case fhirFilterTypes.uri:
                    andSegments = filterByUri({
                        propertyObj, queryParameterValue, columns
                    });
                    break;
                case fhirFilterTypes.dateTime:
                case fhirFilterTypes.date:
                case fhirFilterTypes.period:
                case fhirFilterTypes.instant:
                    andSegments = filterByDateTime(
                        {
                            queryParameterValue,
                            propertyObj,
                            resourceType,
                            columns
                        }
                    );
                    break;
                case fhirFilterTypes.token:
                    if (propertyObj.field === 'meta.security') {
                        andSegments = filterBySecurityTag({
                            queryParameterValue, propertyObj, columns,
                            fnUseAccessIndex: (accessCode) =>
                                this.configManager.useAccessIndex &&
                                this.accessIndexManager.resourceHasAccessIndexForAccessCodes({
                                    resourceType,
                                    accessCodes: [accessCode]
                                })
                        });
                    } else {
                        andSegments = filterByToken({
                            queryParameterValue, propertyObj, columns
                        });
                    }
                    break;
                case fhirFilterTypes.reference:
                    if (isUrl(queryParameterValue)) {
                        andSegments = filterByCanonical({
                            propertyObj, queryParameterValue, columns
                        });
                    } else {
                        andSegments = filterByReference(
                            {
                                propertyObj,
                                queryParameterValue,
                                columns,
                            }
                        );
                    }
                    break;
                default:
                    throw new Error('Unknown type=' + propertyObj.type);
            }
        }

        return {columns, andSegments};
    }
}

module.exports = {
    R4SearchQueryCreator
};

