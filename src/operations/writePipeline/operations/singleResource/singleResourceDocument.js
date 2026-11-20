const deepcopy = require('deepcopy');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');
const { GRIDFS, BLOB_OP } = require('../../../../constants');
const { WRITE_ITEM_STATUS } = require('../../writeItem');

/**
 * What the responders of single-resource writes that answer with the written resource (PUT,
 * PATCH) share: the entry of a document that was not written, and the document of the response.
 */

/**
 * Returns the entry, neither created nor updated, of a document that was not written: its id,
 * uuid, source assigning authority and resource type.
 * @param {Object} document
 * @returns {{created: boolean, updated: boolean, id: string, uuid: string, sourceAssigningAuthority: string, resourceType: string}}
 */
function unchangedEntry (document) {
    return {
        created: false,
        updated: false,
        id: document.id,
        uuid: document._uuid,
        sourceAssigningAuthority: document._sourceAssigningAuthority,
        resourceType: document.resourceType
    };
}

/**
 * Builds the document a single-resource write answers with: a copy of the item's candidate, or of
 * its stored document when the item was unchanged, with its GridFS attachments and externalized
 * base64 data put back inline, its identifiers and extended-Group tag enriched, then serialized
 * as a FHIR resource in place. Returns the document and the resource, which are the same object.
 * The item is not modified.
 * @param {import('../../writeItem').WriteItem} item
 * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
 * @param {import('../../../../dataLayer/databaseAttachmentManager').DatabaseAttachmentManager} databaseAttachmentManager
 * @param {import('../../../../dataLayer/base64DataManager').Base64DataManager} base64DataManager
 * @param {import('../../../../enrich/providers/identifierEnrichmentProvider').IdentifierEnrichmentProvider} identifierEnrichmentProvider
 * @param {import('../../../../enrich/providers/groupExtendedTagEnrichmentProvider').GroupExtendedTagEnrichmentProvider} groupExtendedTagEnrichmentProvider
 * @returns {Promise<{document: Object, resource: Object}>}
 */
async function buildResponseDocumentAsync ({
    item,
    requestInfo,
    databaseAttachmentManager,
    base64DataManager,
    identifierEnrichmentProvider,
    groupExtendedTagEnrichmentProvider
}) {
    const unchanged = item.status === WRITE_ITEM_STATUS.UNCHANGED;
    let document = deepcopy(unchanged ? item.stored : item.candidate);
    document = await databaseAttachmentManager.transformAttachments(document, GRIDFS.RETRIEVE);
    document = await base64DataManager.transformAsync(document, BLOB_OP.RETRIEVE, requestInfo);
    identifierEnrichmentProvider.enrichIdentifierList(document);
    [document] = await groupExtendedTagEnrichmentProvider.enrichAsync({ resources: [document] });
    return { document, resource: FhirResourceSerializer.serialize(document) };
}

module.exports = {
    unchangedEntry,
    buildResponseDocumentAsync
};
