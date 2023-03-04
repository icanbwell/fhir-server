const {EnrichmentProvider} = require('./enrichmentProvider');
const {assertTypeEquals} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {isUuid} = require('../../utils/uid.util');
const {ReferenceParser} = require('../../utils/referenceParser');

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
        /**
         * @type {string}
         */
        const preferHeader = parsedArgs.headers &&
            (parsedArgs.headers['prefer'] || parsedArgs.headers['Prefer']);
        if (preferHeader) {
            const parts = preferHeader.split('=');
            if (parts[0] === 'global_id' && parts.slice(-1)[0] === 'true') {
                for (const resource of resources) {
                    if (resource.id && !isUuid(resource.id)) {
                        const uuid = resource._uuid;
                        if (uuid) {
                            resource.id = uuid;
                        }
                    }
                    if (resource.contained && resource.contained.length > 0) {
                        const contained = await this.enrichAsync(
                            {
                                resources: resource.contained,
                                parsedArgs
                            }
                        );
                        resource.contained = contained;
                    }
                    if (resource.updateReferencesAsync) {
                        // update references
                        await resource.updateReferencesAsync(
                            {
                                fnUpdateReferenceAsync: async (reference) => await this.updateReferenceAsync(
                                    {
                                        reference
                                    }
                                )
                            }
                        );
                    }

                }
            }
        }

        return resources;
    }

    /**
     * updates references
     * @param {Reference} reference
     * @return {Promise<Reference>}
     */
    async updateReferenceAsync({reference}) {
        if (reference.reference) {
            const {id} = ReferenceParser.parseReference(reference.reference);
            if (!isUuid(id) && reference._uuid) {
                reference.reference = reference._uuid;
            }
        }
        return reference;
    }

    /**
     * Runs any registered enrichment providers
     * @param {ParsedArgs} parsedArgs
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync({entries, parsedArgs}) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync(
                    {
                        resources: [entry.resource],
                        parsedArgs
                    }
                ))[0];
            }
        }
        return entries;
    }
}

module.exports = {
    GlobalIdEnrichmentProvider
};
