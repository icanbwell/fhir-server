const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ReferenceParser } = require('../utils/referenceParser');
const { QueryItem } = require('../operations/graph/queryItem');
const { AUTH_USER_TYPES, CONSENT_CATEGORY } = require('../constants');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { ConfigManager } = require('./configManager');
const { SearchManager } = require('../operations/search/searchManager');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');

/**
 * The request info the view-control Consent lookup searches with. The caller's scope is kept, so the
 * tenant filter still applies. A delegated caller gets a copy with the user type and actor cleared: the
 * delegated narrowing (for an Organization actor, only resources tagged with an allowed connection type)
 * would hide the user's own Consent from the lookup, and a missed Consent means hidden data is returned.
 * personIdFromJwtToken stays set. Any other caller's request info is passed through as is.
 * @param {FhirRequestInfo} requestInfo
 * @return {FhirRequestInfo}
 */
function toViewControlLookupRequestInfo(requestInfo) {
    if (requestInfo?.userType !== AUTH_USER_TYPES.delegatedUser) {
        return requestInfo;
    }
    return Object.assign(Object.create(Object.getPrototypeOf(requestInfo)), requestInfo, {
        userType: null,
        actor: null
    });
}

class PatientDataViewControlManager {
    /**
     * @typedef {Object} PatientDataViewControlManagerParams
     * @property {ConfigManager} configManager
     * @property {SearchManager} searchManager
     * @property {R4ArgsParser} r4ArgsParser
     *
     * @param {PatientDataViewControlManagerParams} params
     */
    constructor({ configManager, searchManager, r4ArgsParser }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);

        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
    }

    /**
     * Fetch a Person's dataConnectionViewControl Consents and the resources they hide.
     *
     * The caller passes the Person and that Person's owner (the client the Person belongs to), which
     * decides enrollment: an owner that isn't in configManager.clientsWithDataConnectionViewControl
     * gets an empty result without a Consent search. A Person with no owner tag (bad data: writes
     * reject it) can't be shown to be outside the enrolled clients, so it is treated as enrolled and
     * the Consent is applied. That removes data and never adds it, and it keeps one such Person from
     * failing every read.
     * @param {{
     *  requestInfo: FhirRequestInfo,
     *  base_version: string,
     *  personId: string,
     *  owner: string|null|undefined
     * }}
     * @return {Promise<{
     *  viewControlResourceToExcludeMap: {[resourceType: string]: string[]},
     *  viewControlConsentQueries: QueryItem[],
     *  viewControlConsentQueryOptions: import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]
     * }>}
     */
    async getConsentAsync({
        requestInfo,
        base_version,
        personId,
        owner
    }) {
        assertIsValid(personId, 'dataConnectionViewControl: personId is required');

        // an owner of null/undefined/'' is "enrolled": apply the Consent rather than fail the read
        if (owner && !this.configManager.clientsWithDataConnectionViewControl.includes(owner)) {
            return {
                viewControlResourceToExcludeMap: {},
                viewControlConsentQueries: [],
                viewControlConsentQueryOptions: []
            };
        }

        let resourceType = 'Consent';
        // no prototype: the resourceType comes from stored Consent data, and a type such as
        // `constructor` or `__proto__` must be an ordinary key, not an Object.prototype member
        const viewControlResourceToExcludeMap = Object.create(null);

        const consentArgs = {
            base_version,
            // only an active Consent applies, as in the other Consent lookups; status also lets the
            // query use the {status, patient._uuid} index instead of scanning the collection
            status: 'active',
            // a Consent tagged hidden is still the user's choice, so it must still apply
            _includeHidden: true,
            patient: `Patient/person.${personId}`,
            category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
        };

        let {
            entries: viewControlConsentEntries,
            queryItems: viewControlConsentQueries,
            options: viewControlConsentQueryOptions
        } = await this.searchManager.fetchResourcesByArgsAsync({
            resourceType,
            base_version,
            requestInfo: toViewControlLookupRequestInfo(requestInfo),
            explain: false,
            debug: false,
            applyPatientFilter: false,
            parsedArgs: this.r4ArgsParser.parseArgs({
                resourceType,
                args: consentArgs
            })
        });

        for (const entry of viewControlConsentEntries) {
            for (const ref of entry.resource.provision?.data ?? []) {
                const reference = ref?.reference?.reference;
                if (!reference) {
                    continue;
                }
                const { resourceType: refType, id: refId } = ReferenceParser.parseReference(reference);
                if (!refType || !refId) {
                    continue;
                }
                (viewControlResourceToExcludeMap[refType] ??= []).push(refId);
            }
        }

        await this.hideAttachmentBinariesOfHiddenDocumentReferencesAsync({
            requestInfo,
            base_version,
            viewControlResourceToExcludeMap
        });

        return {
            viewControlResourceToExcludeMap,
            viewControlConsentQueries,
            viewControlConsentQueryOptions
        };
    }

    /**
     * Adds to the exclude map the Binary resources that a hidden DocumentReference points at.
     *
     * A Binary is found by its own securityContext rather than through its DocumentReference, so
     * when the Consent hides a DocumentReference (the user deleted it) its content would otherwise
     * still be returned. The DocumentReferences are read with the caller's own access, and only
     * their `content`; the Binary ids found are only ever used to hide data.
     * @param {{
     *  requestInfo: FhirRequestInfo,
     *  base_version: string,
     *  viewControlResourceToExcludeMap: {[resourceType: string]: string[]}
     * }}
     * @return {Promise<void>}
     */
    async hideAttachmentBinariesOfHiddenDocumentReferencesAsync({
        requestInfo,
        base_version,
        viewControlResourceToExcludeMap
    }) {
        const documentReferenceIds = viewControlResourceToExcludeMap.DocumentReference;
        if (!documentReferenceIds || documentReferenceIds.length === 0) {
            return;
        }
        const resourceType = 'DocumentReference';
        const { entries } = await this.searchManager.fetchResourcesByArgsAsync({
            resourceType,
            base_version,
            requestInfo,
            explain: false,
            debug: false,
            applyPatientFilter: false,
            parsedArgs: this.r4ArgsParser.parseArgs({
                resourceType,
                args: { base_version, _id: documentReferenceIds.join(','), _elements: 'content' }
            })
        });
        const binaryIds = new Set(viewControlResourceToExcludeMap.Binary ?? []);
        const sizeBefore = binaryIds.size;
        for (const entry of entries) {
            for (const content of entry.resource?.content ?? []) {
                const binaryId = getBinaryIdFromAttachmentUrl(content?.attachment?.url);
                if (binaryId) {
                    binaryIds.add(binaryId);
                }
            }
        }
        if (binaryIds.size > sizeBefore) {
            viewControlResourceToExcludeMap.Binary = [...binaryIds];
        }
    }
}

/**
 * The Binary id in an attachment url such as `Binary/123` or `https://host/4_0_0/Binary/123`.
 * @param {string|undefined} url
 * @return {string|undefined}
 */
function getBinaryIdFromAttachmentUrl(url) {
    if (typeof url !== 'string') {
        return undefined;
    }
    const match = /(?:^|\/)Binary\/([^/?#|]+)/.exec(url);
    return match ? match[1] : undefined;
}

module.exports = {
    PatientDataViewControlManager,
    getBinaryIdFromAttachmentUrl
};
