const { EnrichmentProvider } = require('./enrichmentProvider');

const DERIVED_TEXT_EXTENSION_URL = 'https://www.icanbwell.com/attachment-derived-text';

/**
 * Reverse-lookup for `Binary` resources: fhir-notes-vector-store never indexes Binary as an
 * independent source (see design doc's "Binary reverse lookup" section) -- its content only
 * appears indirectly, as bytes resolved from a DocumentReference/DiagnosticReport attachment
 * `url`. This finds whichever attachment referenced this Binary and reuses its derived text,
 * via a top-level extension since Binary's own `contentType`/`data` describe its actual stored
 * bytes and must not be repurposed. Runs after the Binary's own authorized fetch.
 */
class BinaryDerivedTextEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {import('../../utils/clinicalNoteTextRetriever').ClinicalNoteTextRetriever} params.clinicalNoteTextRetriever
     */
    constructor ({ clinicalNoteTextRetriever }) {
        super();
        this.clinicalNoteTextRetriever = clinicalNoteTextRetriever;
    }

    /**
     * True only when the caller asked for exactly one specific resource by id -- whether via a
     * true read/vread operation or a search with an explicit `_id=`/`id=` param. Both are
     * bounded to one resource, so both are safe triggers; a broad search is never a trigger
     * even if it happens to return exactly one bundle entry.
     * @param {ParsedArgs} parsedArgs
     * @returns {boolean}
     */
    static isSingleResourceRequest (parsedArgs) {
        const idArg = parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id');
        return Boolean(
            idArg &&
            idArg.queryParameterValue &&
            idArg.queryParameterValue.values &&
            idArg.queryParameterValue.values.length === 1
        );
    }

    /**
     * @param {ParsedArgs} parsedArgs
     * @returns {boolean}
     */
    static isDerivedTextTrigger (parsedArgs) {
        const contentArg = parsedArgs.get('_content');
        return Boolean(contentArg && contentArg.queryParameterValue.value === '');
    }

    /**
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync ({ resources, parsedArgs, enrichmentContext }) {
        if (!BinaryDerivedTextEnrichmentProvider.isDerivedTextTrigger(parsedArgs) ||
            !BinaryDerivedTextEnrichmentProvider.isSingleResourceRequest(parsedArgs)) {
            return resources;
        }
        for (const resource of resources) {
            if (!resource || resource.resourceType !== 'Binary') {
                continue;
            }
            const text = await this.clinicalNoteTextRetriever.getReassembledTextForBinaryAsync({
                binaryReference: `Binary/${resource.id}`
            });
            if (!text) {
                continue;
            }
            resource.extension = resource.extension || [];
            resource.extension.push({ url: DERIVED_TEXT_EXTENSION_URL, valueString: text });
        }
        return resources;
    }

    /**
     * @param {Object} params
     * @param {BundleEntry[]} params.entries
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries, parsedArgs, enrichmentContext }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync({
                    resources: [entry.resource], parsedArgs, enrichmentContext
                }))[0];
            }
        }
        return entries;
    }
}

module.exports = { BinaryDerivedTextEnrichmentProvider };
