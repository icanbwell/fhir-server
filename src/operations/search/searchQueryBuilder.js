const {buildStu3SearchQuery} = require('../query/stu3');
const {buildDstu2SearchQuery} = require('../query/dstu2');
const {assertTypeEquals} = require('../../utils/assertType');
const {VERSIONS} = require('../../middleware/fhir/utils/constants');
const {R4SearchQueryCreator} = require('../query/r4');

class SearchQueryBuilder {
    /**
     * constructor
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     */
    constructor (
        {
            r4SearchQueryCreator
        }
    ) {
        /**
         * @type {R4SearchQueryCreator}
         */
        this.r4SearchQueryCreator = r4SearchQueryCreator;
        assertTypeEquals(r4SearchQueryCreator, R4SearchQueryCreator);
    }

    /**
     * Build Search-query from parsed args based on base_version and resource type
     * @typedef {Object} BuildSearchQueryBasedOnVersion
     * @property {string} base_version Base Version
     * @property {ParsedArgs} parsedArgs Parsed Args
     * @property {boolean | undefined} useHistoryTable boolean to use history table or not
     * @property {string} resourceType Resource Type
     * @param {BuildSearchQueryBasedOnVersion} param Params for building search query based on version
     * @returns {{ query: import('mongodb').Document, columns: Set<string> | undefined }}
     */
    buildSearchQueryBasedOnVersion ({ base_version, parsedArgs, resourceType, useHistoryTable}) {
        /** @type {import('mongodb').Document} */
        let query;
        /** @type {Set<string>} */
        let columns;
        try {
            if (base_version === VERSIONS['3_0_1']) {
                query = buildStu3SearchQuery(parsedArgs);
            } else if (base_version === VERSIONS['1_0_2']) {
                query = buildDstu2SearchQuery(parsedArgs);
            } else {
                ({query, columns} = this.r4SearchQueryCreator.buildR4SearchQuery({
                    resourceType, parsedArgs, useHistoryTable
                }));
            }

            return {query, columns};
        } catch (e) {
            console.error(e);
            throw e;
        }
    }
}

module.exports = {
    SearchQueryBuilder
};
