const {EnrichmentProvider} = require('./enrichmentProvider');
const {assertTypeEquals} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');

/**
 * Abstract base class for an enrichment provider.  Inherit from this to create a new enrichment provider
 */
class GlobalIdEnrichmentProvider extends EnrichmentProvider {

    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     */
    constructor({databaseQueryFactory}) {
        super();

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
    }

    /**
     * enrich the specified resources
     * @param {Resource[]} resources
     * @param {ParsedArgs} parsedArgs
     * @return {Promise<Resource[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichAsync({resources, parsedArgs}) {
        throw Error('Not Implemented');
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async enrichBundleEntriesAsync({entries, parsedArgs}) {
        throw Error('Not Implemented');
    }
}

module.exports = {
    GlobalIdEnrichmentProvider
};
