const { fhirFilterTypes } = require('./customQueries');
const { searchParameterQueries } = require('../../searchParameters/searchParameters');
const { filterById } = require('./filters/id');
const { filterByString } = require('./filters/string');
const { filterByUri } = require('./filters/uri');
const { filterByDateTime } = require('./filters/dateTime');
const { filterByToken } = require('./filters/token');
const { filterByReference } = require('./filters/reference');
const { filterByMissing } = require('./filters/missing');
const { filterByContains } = require('./filters/contains');
const { filterByAboveAndBelow, filterByAbove, filterByBelow } = require('./filters/aboveAndBelow');
const { convertGraphQLParameters } = require('./convertGraphQLParameters');
const { filterByPartialText } = require('./filters/partialText');

// /**
//  * @type {import('winston').logger}
//  */
// const logger = require('@asymmetrik/node-fhir-server-core').loggers.get();

/**
 * Builds a mongo query for search parameters
 * @param {string} resourceName
 * @param {Object} args
 * @returns {{query:import('mongodb').Document, columns: Set}} A query object to use with Mongo
 */
module.exports.buildR4SearchQuery = (resourceName, args) => {
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
    if (
        args['_lastUpdated'] &&
        Array.isArray(args['_lastUpdated']) &&
        args['_lastUpdated'].length > 1
    ) {
        const lastUpdatedArray = args['_lastUpdated'];
        const gtValue = lastUpdatedArray.at(0);
        const ltValue = lastUpdatedArray.at(1);
        const hasRange = gtValue.indexOf('gt') > -1 || gtValue.indexOf('lt') > -1;
        args['_lastUpdated'] = [
            hasRange ? gtValue : `gt${gtValue}`,
            hasRange ? ltValue : `lt${ltValue}`,
        ];
    }

    // ---- end of backward compatibility mappings ---

    /**
     * list of columns used in the query
     * this is used to pick index hints
     * @type {Set}
     */
    let columns = new Set();
    /**
     * and segments
     * these are combined to create the query
     * @type {Object[]}
     */
    let and_segments = [];

    // add FHIR queries
    for (const [resourceType, resourceObj] of Object.entries(searchParameterQueries)) {
        if (resourceType === resourceName || resourceType === 'Resource') {
            for (const [
                /** @type {string} **/ queryParameter,
                /** @type {import('../common/types').SearchParameterDefinition} **/ propertyObj,
            ] of Object.entries(resourceObj)) {
                /**
                 * @type {string | string[]}
                 */
                let queryParameterValue = args[`${queryParameter}`];
                queryParameterValue = convertGraphQLParameters(
                    queryParameterValue,
                    args,
                    queryParameter
                );
                // if just a query parameter is passed then check it
                if (queryParameterValue) {
                    // handle id differently since it is a token, but we want to do exact match
                    if (queryParameter === '_id') {
                        filterById(queryParameterValue, and_segments, propertyObj, columns);
                        continue; // skip processing rest of this loop
                    }
                    switch (propertyObj.type) {
                        case fhirFilterTypes.string:
                            filterByString(queryParameterValue, and_segments, propertyObj, columns);
                            break;
                        case fhirFilterTypes.uri:
                            filterByUri(and_segments, propertyObj, queryParameterValue, columns);
                            break;
                        case fhirFilterTypes.dateTime:
                        case fhirFilterTypes.date:
                        case fhirFilterTypes.period:
                        case fhirFilterTypes.instant:
                            filterByDateTime(
                                queryParameterValue,
                                propertyObj,
                                and_segments,
                                resourceName,
                                columns
                            );
                            break;
                        case fhirFilterTypes.token:
                            filterByToken(queryParameterValue, propertyObj, and_segments, columns);
                            break;
                        case fhirFilterTypes.reference:
                            filterByReference(
                                propertyObj,
                                and_segments,
                                queryParameterValue,
                                columns
                            );
                            break;
                        default:
                            throw new Error('Unknown type=' + propertyObj.type);
                    }
                } else if (args[`${queryParameter}:missing`]) {
                    filterByMissing(args, queryParameter, and_segments, propertyObj, columns);
                } else if (args[`${queryParameter}:contains`]) {
                    filterByContains(and_segments, propertyObj, queryParameter, args, columns);
                } else if (args[`${queryParameter}:above`] && args[`${queryParameter}:below`]) {
                    filterByAboveAndBelow(and_segments, propertyObj, args, queryParameter, columns);
                } else if (args[`${queryParameter}:above`]) {
                    filterByAbove(and_segments, propertyObj, args, queryParameter, columns);
                } else if (args[`${queryParameter}:below`]) {
                    filterByBelow(and_segments, propertyObj, args, queryParameter, columns);
                } else if (args[`${queryParameter}:text`]) {
                    filterByPartialText(args, queryParameter, and_segments, propertyObj, columns);
                }
            }
        }
    }

    /**
     * query to run on mongo
     * @type {{$and: Object[]}}
     */
    let query = {};

    if (and_segments.length !== 0) {
        // noinspection JSUndefinedPropertyAssignment
        query.$and = and_segments;
    }

    return {
        query: query,
        columns: columns,
    };
};
