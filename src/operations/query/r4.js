const {fhirFilterTypes} = require('./customQueries');
const {searchParameterQueries} = require('../../searchParameters/searchParameters');
const {filterById} = require('./filters/id');
const {filterByString} = require('./filters/string');
const {filterByUri} = require('./filters/uri');
const {filterByDateTime} = require('./filters/dateTime');
const {filterByToken} = require('./filters/token');
const {filterByReference} = require('./filters/reference');
const {filterByMissing} = require('./filters/missing');
const {filterByContains} = require('./filters/contains');
const {filterByAboveAndBelow, filterByAbove, filterByBelow} = require('./filters/aboveAndBelow');
const {convertGraphQLParameters} = require('./convertGraphQLParameters');
const {filterByPartialText} = require('./filters/partialText');
const {filterByCanonical} = require('./filters/canonical');
const {filterBySecurityTag} = require('./filters/securityTag');
const {assertTypeEquals} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {AccessIndexManager} = require('../common/accessIndexManager');
const {FhirTypesManager} = require('../../fhir/fhirTypesManager');

function isUrl(queryParameterValue) {
    return queryParameterValue.startsWith('http://') ||
        queryParameterValue.startsWith('https://') ||
        queryParameterValue.startsWith('ftp://');
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
        let columns = new Set();
        /**
         * and segments
         * these are combined to create the query
         * @type {Object[]}
         */
        let and_segments = [];

        // add FHIR queries
        for (const [searchParameterResourceType, searchParameterObj] of Object.entries(searchParameterQueries)) {
            if (searchParameterResourceType === resourceType || searchParameterResourceType === 'Resource') {
                for (const [
                    /** @type {string} **/ queryParameter,
                    /** @type {import('../common/types').SearchParameterDefinition} **/ propertyObj,
                ] of Object.entries(searchParameterObj)) {
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
                    let queryParameterValue = args[`${queryParameter}`];
                    let negation = false;
                    if (args[`${queryParameter}:not`]) {
                        negation = true;
                        queryParameterValue = args[`${queryParameter}:not`];
                    }

                    queryParameterValue = convertGraphQLParameters(
                        queryParameterValue,
                        args,
                        queryParameter
                    );
                    // if just a query parameter is passed then check it
                    if (queryParameterValue) {
                        // handle id differently since it is a token, but we want to do exact match
                        if (queryParameter === '_id') {
                            filterById({
                                queryParameterValue, propertyObj, columns
                            }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                        } else {
                            switch (propertyObj.type) {
                                case fhirFilterTypes.string:
                                    filterByString({
                                        queryParameterValue, propertyObj, columns
                                    }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                                    break;
                                case fhirFilterTypes.uri:
                                    filterByUri({
                                        propertyObj, queryParameterValue, columns
                                    }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                                    break;
                                case fhirFilterTypes.dateTime:
                                case fhirFilterTypes.date:
                                case fhirFilterTypes.period:
                                case fhirFilterTypes.instant:
                                    filterByDateTime(
                                        {
                                            queryParameterValue,
                                            propertyObj,
                                            resourceType,
                                            columns
                                        }
                                    ).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                                    break;
                                case fhirFilterTypes.token:
                                    if (propertyObj.field === 'meta.security') {
                                        filterBySecurityTag({
                                            queryParameterValue, propertyObj, columns,
                                            fnUseAccessIndex: (accessCode) =>
                                                this.configManager.useAccessIndex &&
                                                this.accessIndexManager.resourceHasAccessIndexForAccessCodes({
                                                    resourceType,
                                                    accessCodes: [accessCode]
                                                })
                                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                                    } else {
                                        filterByToken({
                                            queryParameterValue, propertyObj, columns
                                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                                    }
                                    break;
                                case fhirFilterTypes.reference:
                                    if (isUrl(queryParameterValue)) {
                                        filterByCanonical({
                                            propertyObj, queryParameterValue, columns
                                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                                    } else {
                                        filterByReference(
                                            {
                                                propertyObj,
                                                queryParameterValue,
                                                columns,
                                            }
                                        ).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                                    }
                                    break;
                                default:
                                    throw new Error('Unknown type=' + propertyObj.type);
                            }
                        }
                    }

                    if (args[`${queryParameter}:missing`]) {
                        filterByMissing({
                            args, queryParameter, propertyObj, columns
                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                    } else if (args[`${queryParameter}:contains`]) {
                        filterByContains({
                            propertyObj, queryParameter, args, columns
                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                    } else if (args[`${queryParameter}:above`] && args[`${queryParameter}:below`]) {
                        filterByAboveAndBelow({
                            propertyObj, args, queryParameter, columns
                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                    } else if (args[`${queryParameter}:above`]) {
                        filterByAbove({
                            propertyObj, args, queryParameter, columns
                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                    } else if (args[`${queryParameter}:below`]) {
                        filterByBelow({
                            propertyObj, args, queryParameter, columns
                        }).forEach(q => and_segments.push(negation ? {$nor: [q]} : q));
                    } else if (args[`${queryParameter}:text`]) {
                        filterByPartialText({
                            args, queryParameter, propertyObj, columns,
                        }).forEach(q => and_segments.push(q));
                    } else if (args[`${queryParameter}:not:text`] || args[`${queryParameter}:text:not`]) {
                        filterByPartialText({
                            args, queryParameter, propertyObj, columns,
                        }).forEach(q => and_segments.push({$nor: [q]}));
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
    }
}

module.exports = {
    R4SearchQueryCreator
};

