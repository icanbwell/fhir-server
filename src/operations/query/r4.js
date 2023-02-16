const {fhirFilterTypes} = require('./customQueries');
const {filterById} = require('./filters/id');
const {filterByString} = require('./filters/string');
const {filterByUri} = require('./filters/uri');
const {filterByDateTime} = require('./filters/dateTime');
const {filterByToken} = require('./filters/token');
const {filterByReference} = require('./filters/reference');
const {filterByMissing} = require('./filters/missing');
const {filterByContains} = require('./filters/contains');
const {filterByAbove, filterByBelow} = require('./filters/aboveAndBelow');
const {filterByPartialText} = require('./filters/partialText');
const {filterByCanonical} = require('./filters/canonical');
const {filterBySecurityTag} = require('./filters/securityTag');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {AccessIndexManager} = require('../common/accessIndexManager');
const {R4ArgsParser} = require('./r4ArgsParser');
const {removeDuplicatesWithLambda} = require('../../utils/list.util');
const {ParsedArgs} = require('./parsedArgsItem');

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
     * @param {R4ArgsParser} r4ArgsParser
     */
    constructor({
                    configManager,
                    accessIndexManager,
                    r4ArgsParser
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
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
    }

    /**
     * Builds a mongo query for search parameters
     * @param {string} resourceType
     * @param {ParsedArgs} parsedArgs
     * @param {boolean|undefined} [useHistoryTable]
     * @returns {{query:import('mongodb').Document, columns: Set}} A query object to use with Mongo
     */
    buildR4SearchQuery({resourceType, parsedArgs, useHistoryTable}) {
        assertIsValid(resourceType);
        assertTypeEquals(parsedArgs, ParsedArgs);
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

        for (const /** @type {ParsedArgsItem} */ parsedArg of parsedArgs.parsedArgItems) {
            if (parsedArg.queryParameterValue && parsedArg.propertyObj) {
                let {
                    /** @type {Set} */
                    columns,
                    /** @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]} */
                    andSegments
                } = this.getColumnsAndSegmentsForParameterType({
                    resourceType,
                    queryParameter: parsedArg.queryParameter,
                    queryParameterValue: parsedArg.queryParameterValue,
                    propertyObj: parsedArg.propertyObj,
                    enableGlobalIdSupport: this.configManager.enableGlobalIdSupport,
                    parsedArg,
                    useHistoryTable
                });

                // replace andSegments according to modifiers
                if (parsedArg.modifiers.includes('missing')) {
                    andSegments = filterByMissing({
                        queryParameterValue: parsedArg.queryParameterValue, propertyObj: parsedArg.propertyObj, columns
                    });
                } else if (parsedArg.modifiers.includes('contains')) {
                    andSegments = filterByContains({
                        propertyObj: parsedArg.propertyObj, queryParameterValue: parsedArg.queryParameterValue, columns
                    });
                } else if (parsedArg.modifiers.includes('above')) {
                    andSegments = filterByAbove({
                        propertyObj: parsedArg.propertyObj, queryParameterValue: parsedArg.queryParameterValue, columns
                    });
                } else if (parsedArg.modifiers.includes('below')) {
                    andSegments = filterByBelow({
                        propertyObj: parsedArg.propertyObj, queryParameterValue: parsedArg.queryParameterValue, columns
                    });
                } else if (parsedArg.modifiers.includes('text')) {
                    columns = new Set(); // text overrides datatype column logic
                    andSegments = filterByPartialText({
                        queryParameterValue: parsedArg.queryParameterValue, propertyObj: parsedArg.propertyObj, columns,
                    });
                }

                // apply negation according to not modifier and add to final collection
                if (parsedArg.modifiers.includes('not')) {
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
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        let query = {};

        if (totalAndSegments.length !== 0) {
            // noinspection JSUndefinedPropertyAssignment
            query.$and = totalAndSegments;
        }

        query = this.simplifyFilter({filter: query});

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
     * @param {SearchParameterDefinition} propertyObj
     * @param {boolean} enableGlobalIdSupport
     * @param {ParsedArgsItem} parsedArg
     * @param {boolean|undefined} useHistoryTable
     * @returns {{columns: Set, andSegments: import('mongodb').Filter<import('mongodb').DefaultSchema>[]}} columns and andSegments for query parameter
     */
    getColumnsAndSegmentsForParameterType(
        {
            resourceType,
            queryParameter,
            queryParameterValue,
            propertyObj,
            enableGlobalIdSupport,
            parsedArg,
            useHistoryTable
        }
    ) {
        /**
         * list of columns used in the query for this parameter
         * this is used to pick index hints
         * @type {Set}
         */
        let columns = new Set();

        /**
         * and segments
         * these are combined to create the query
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
         */
        let andSegments = [];


        // get the set of columns required for the query
        if (queryParameter === '_id') {
            // handle id differently since it is a token, but we want to do exact match
            andSegments = filterById({
                queryParameterValue, propertyObj, columns,
                enableGlobalIdSupport,
                useHistoryTable
            });
        } else if (propertyObj) {
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
                                parsedArg,
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

    /**
     * simplifies the filter by removing duplicate segments and $or statements with just one child
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} filter
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    simplifyFilter({filter}) {
        // simplify $or
        if (filter.$or && filter.$or.length > 1) {
            filter.$or = removeDuplicatesWithLambda(filter.$or,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$or && filter.$or.length > 0) {
            filter.$or = filter.$or.map(f => this.simplifyFilter({filter: f}));
        }
        if (filter.$or && filter.$or.length === 1) {
            filter = filter.$or[0];
        }
        // simplify $nor
        if (filter.$nor && filter.$nor.length > 1) {
            filter.$nor = removeDuplicatesWithLambda(filter.$nor,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$nor && filter.$nor.length > 0) {
            filter.$nor = filter.$nor.map(f => this.simplifyFilter({filter: f}));
        }
        // simplify $and
        if (filter.$and && filter.$and.length > 1) {
            filter.$and = removeDuplicatesWithLambda(filter.$and,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$and && filter.$and.length > 0) {
            filter.$and = filter.$and.map(f => this.simplifyFilter({filter: f}));
        }
        if (filter.$and && filter.$and.length === 1) {
            filter = filter.$and[0];
        }
        // simplify $in
        if (filter.$in && filter.$in.length === 1) {
            filter = filter.$in[0];
        }

        return filter;
    }


}

module.exports = {
    R4SearchQueryCreator
};

