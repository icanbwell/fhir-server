const { EnrichmentProvider } = require('./enrichmentProvider');

const DERIVED_TEXT_EXTENSION_URL = 'https://www.icanbwell.com/attachment-derived-text';
const ENRICHABLE_RESOURCE_TYPES = new Set(['DocumentReference', 'DiagnosticReport']);

/**
 * Attaches reassembled attachment text (from fhir-notes-vector-store) as a sibling
 * text/plain content/presentedForm entry, triggered by an empty `_content` value on a
 * single-resource request. Runs after the resource's own authorized fetch -- see
 * docs/superpowers/specs/2026-09-10-text-content-search-design.md, "Security model".
 */
class AttachmentTextEnrichmentProvider extends EnrichmentProvider {
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
        if (!AttachmentTextEnrichmentProvider.isDerivedTextTrigger(parsedArgs) ||
            !AttachmentTextEnrichmentProvider.isSingleResourceRequest(parsedArgs)) {
            return resources;
        }
        for (const resource of resources) {
            if (!resource || !ENRICHABLE_RESOURCE_TYPES.has(resource.resourceType)) {
                continue;
            }
            if (resource.resourceType === 'DocumentReference' && Array.isArray(resource.content)) {
                await this.enrichAttachmentArrayAsync({
                    resourceId: resource.id,
                    array: resource.content,
                    getAttachment: (entry) => entry.attachment,
                    wrapAttachment: (attachment) => ({ attachment })
                });
            } else if (resource.resourceType === 'DiagnosticReport' && Array.isArray(resource.presentedForm)) {
                await this.enrichAttachmentArrayAsync({
                    resourceId: resource.id,
                    array: resource.presentedForm,
                    getAttachment: (entry) => entry,
                    wrapAttachment: (attachment) => attachment
                });
            }
        }
        return resources;
    }

    /**
     * Mutates `array` in place, appending a derived text/plain sibling per original entry that
     * has reassembled text available.
     * @param {Object} params
     * @param {string} params.resourceId
     * @param {Array<Object>} params.array
     * @param {(entry: Object) => Object} params.getAttachment
     * @param {(attachment: Object) => Object} params.wrapAttachment
     */
    async enrichAttachmentArrayAsync ({ resourceId, array, getAttachment, wrapAttachment }) {
        const originalLength = array.length;
        for (let index = 0; index < originalLength; index++) {
            const chunkGroupId = `${resourceId}-${index}`;
            const text = await this.clinicalNoteTextRetriever.getReassembledTextAsync({ chunkGroupId });
            if (!text) {
                continue;
            }
            const derivedAttachment = {
                contentType: 'text/plain',
                data: Buffer.from(text, 'utf-8').toString('base64'),
                extension: [{ url: DERIVED_TEXT_EXTENSION_URL, valueBoolean: true }]
            };
            array.push(wrapAttachment(derivedAttachment));
        }
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

module.exports = { AttachmentTextEnrichmentProvider };
