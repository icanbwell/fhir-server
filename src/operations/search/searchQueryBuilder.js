const { assertTypeEquals } = require('../../utils/assertType');
const { R4SearchQueryCreator } = require('../query/r4');

class SearchQueryBuilder {
    /**
     * constructor
     * @param {R4SearchQueryCreator} r4SearchQueryCreator
     */
    constructor({ r4SearchQueryCreator }) {
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
     * @property {string} operation Operation being performed
     * @property {boolean} isUser if query is created for patient scope
     * @param {BuildSearchQueryBasedOnVersion} param Params for building search query based on version
     * @returns {{ query: import('mongodb').Document, columns: Set<string> | undefined }}
     */
    buildSearchQueryBasedOnVersion({ base_version, parsedArgs, resourceType, useHistoryTable, operation, isUser }) {
        /** @type {import('mongodb').Document} */
        let query;
        /** @type {Set<string>} */
        let columns;
        try {
            ({ query, columns } = this.r4SearchQueryCreator.buildR4SearchQuery({
                resourceType,
                parsedArgs,
                useHistoryTable,
                operation,
                isUser
            }));

            return { query, columns };
        } catch (e) {
            console.error(e);
            throw e;
        }
    }
}

module.exports = {
    SearchQueryBuilder
};
