const {EnrichmentProvider} = require('./enrichmentProvider');
const {assertTypeEquals} = require('../../utils/assertType');
const {DatabaseQueryFactory} = require('../../dataLayer/databaseQueryFactory');
const {isUuid} = require('../../utils/uid.util');
const {isTrue} = require('../../utils/isTrue');
const {IdentifierSystem} = require('../../utils/identifierSystem');

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
        if (parsedArgs.headers && parsedArgs.headers['prefer']) {
            /**
             * @type {string}
             */
            const preferHeader = parsedArgs.headers['prefer'];
            const parts = preferHeader.split('=');
            if (parts[0] === 'global_id' && parts.slice(-1)[0] === 'true') {
                for (const resource of resources) {
                    if (resource.id && !isUuid(resource.id)) {
                        const uuid = resource._uuid;
                        if (uuid) {
                            resource.id = uuid;
                        }
                    }
                    if (resource.updateReferences) {
                        // update references
                        resource.updateReferences(
                            {
                                fnUpdateReference: (reference) => this.updateReference(
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
     * @return {Reference}
     */
    updateReference({reference}) {
        if (reference.reference) {
            const parts = reference.reference.split('/');
            const id = parts.slice(-1)[0];
            if (!isUuid(id) && reference.extension && reference.extension.length > 0) {
                /**
                 * @type {Extension|undefined}
                 */
                const uuidExtension = reference.extension.find(e => e.url === IdentifierSystem.uuid);
                if (uuidExtension) {
                    /**
                     * @type {string|undefined}
                     */
                    const uuid = uuidExtension.valueString;
                    reference.reference = uuid;
                }
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
    // eslint-disable-next-line no-unused-vars
    async enrichBundleEntriesAsync({entries, parsedArgs}) {
        if (parsedArgs['prefer:global_id'] && isTrue(parsedArgs['prefer:global_id'])) {
            for (const entry of entries) {
                /**
                 * @type {Resource}
                 */
                const resource = entry.resource;
                if (resource.id && !isUuid(resource.id)) {
                    const uuid = resource._uuid;
                    if (uuid) {
                        resource.id = uuid;
                    }
                }
            }
        }
        return entries;
    }
}

module.exports = {
    GlobalIdEnrichmentProvider
};
