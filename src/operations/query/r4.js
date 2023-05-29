const {fhirFilterTypes} = require('./customQueries');
const {FilterByString} = require('./filters/string');
const {FilterByUri} = require('./filters/uri');
const {FilterByDateTime} = require('./filters/dateTime');
const {FilterByToken} = require('./filters/token');
const {FilterByReference} = require('./filters/reference');
const {FilterByCanonical} = require('./filters/canonical');
const {FilterBySecurityTag} = require('./filters/securityTag');
const {assertTypeEquals, assertIsValid} = require('../../utils/assertType');
const {ConfigManager} = require('../../utils/configManager');
const {AccessIndexManager} = require('../common/accessIndexManager');
const {R4ArgsParser} = require('./r4ArgsParser');
const {ParsedArgs} = require('./parsedArgs');
const {FieldMapper} = require('./filters/fieldMapper');
const {FilterByMissing} = require('./filters/missing');
const {FilterByContains} = require('./filters/contains');
const {FilterByAbove, FilterByBelow} = require('./filters/aboveAndBelow');
const {FilterByPartialText} = require('./filters/partialText');
const {FilterById} = require('./filters/id');
const {MongoQuerySimplifier} = require('../../utils/mongoQuerySimplifier');
const {FilterParameters} = require('./filters/filterParameters');
const {UrlParser} = require('../../utils/urlParser');

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
         * and segments
         * these are combined to create the query
         * @type {Object[]}
         */
        let totalAndSegments = [];

        for (const /** @type {ParsedArgsItem} */ parsedArg of parsedArgs.parsedArgItems) {
            if (parsedArg.queryParameterValue && parsedArg.propertyObj) {
                /**
                 * @type {FieldMapper}
                 */
                const fieldMapper = new FieldMapper(
                    {
                        enableGlobalIdSupport: this.configManager.enableGlobalIdSupport,
                        useHistoryTable: useHistoryTable
                    }
                );
                /**
                 * @type {FilterParameters}
                 */
                const filterParameters = new FilterParameters(
                    {
                        parsedArg,
                        propertyObj: parsedArg.propertyObj,
                        fnUseAccessIndex: (accessCode) =>
                            this.configManager.useAccessIndex &&
                            this.accessIndexManager.resourceHasAccessIndexForAccessCodes({
                                resourceType,
                                accessCodes: [accessCode]
                            }),
                        fieldMapper,
                        resourceType,
                        enableGlobalIdSupport: this.configManager.enableGlobalIdSupport
                    });

                let {
                    /** @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]} */
                    andSegments
                } = this.getColumnsAndSegmentsForParameterType({
                    parsedArg,
                    filterParameters
                });

                // replace andSegments according to modifiers
                if (parsedArg.modifiers.includes('missing')) {
                    andSegments = new FilterByMissing(filterParameters).filter();
                } else if (parsedArg.modifiers.includes('contains')) {
                    andSegments = new FilterByContains(filterParameters).filter();
                } else if (parsedArg.modifiers.includes('above')) {
                    andSegments = new FilterByAbove(filterParameters).filter();
                } else if (parsedArg.modifiers.includes('below')) {
                    andSegments = new FilterByBelow(filterParameters).filter();
                } else if (parsedArg.modifiers.includes('text')) {
                    andSegments = new FilterByPartialText(filterParameters).filter();
                }

                // apply negation according to not modifier and add to final collection
                if (parsedArg.modifiers.includes('not')) {
                    andSegments.forEach(q => totalAndSegments.push({$nor: [q]}));
                } else {
                    andSegments.forEach(q => totalAndSegments.push(q));
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

        query = MongoQuerySimplifier.simplifyFilter({filter: query});

        /**
         * list of columns used in the query
         * this is used to pick index hints
         * @type {Set}
         */
        const totalColumns = MongoQuerySimplifier.findColumnsInFilter({filter: query});

        console.log(query);
        return {
            query: query,
            columns: totalColumns,
        };
    }

    /**
     * Builds a set of columns and list of segments to apply for a particular query parameter
     * @param {ParsedArgsItem} parsedArg
     * @param {FilterParameters} filterParameters
     * @returns {{andSegments: import('mongodb').Filter<import('mongodb').DefaultSchema>[]}} columns and andSegments for query parameter
     */
    getColumnsAndSegmentsForParameterType(
        {
            parsedArg,
            filterParameters
        }
    ) {
        const queryParameter = parsedArg.queryParameter;
        const queryParameterValue = parsedArg.queryParameterValue;
        const propertyObj = parsedArg.propertyObj;

        /**
         * and segments
         * these are combined to create the query
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
         */
        let andSegments = [];


        // get the set of columns required for the query
        if (queryParameter === '_id') {
            // handle id differently since it is a token, but we want to do exact match
            andSegments = new FilterById(filterParameters).filter();
        } else if (propertyObj) {
            switch (propertyObj.type) {
                case fhirFilterTypes.string:
                    andSegments = new FilterByString(filterParameters).filter();
                    break;
                case fhirFilterTypes.uri:
                    andSegments = new FilterByUri(filterParameters).filter();
                    break;
                case fhirFilterTypes.dateTime:
                case fhirFilterTypes.date:
                case fhirFilterTypes.period:
                case fhirFilterTypes.instant:
                    andSegments = new FilterByDateTime(filterParameters).filter();
                    break;
                case fhirFilterTypes.token:
                    if (propertyObj.firstField === 'meta.security') {
                        andSegments = new FilterBySecurityTag(filterParameters).filter();
                    } else {
                        andSegments = new FilterByToken(filterParameters).filter();
                    }
                    break;
                case fhirFilterTypes.reference:
                    if (queryParameterValue.values && queryParameterValue.values.every(v => UrlParser.isUrl(v))) {
                        andSegments = new FilterByCanonical(filterParameters).filter();
                    } else {
                        andSegments = new FilterByReference(filterParameters).filter();
                    }
                    break;
                default:
                    throw new Error('Unknown type=' + propertyObj.type);
            }
        }

        return {andSegments};
    }
}

module.exports = {
    R4SearchQueryCreator
};

