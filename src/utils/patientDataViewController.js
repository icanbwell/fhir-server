const httpContext = require('express-http-context');
const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ReferenceParser } = require('../utils/referenceParser');
const { QueryItem } = require('../operations/graph/queryItem');
const { CONSENT_CATEGORY, HTTP_CONTEXT_KEYS } = require('../constants');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { ConfigManager } = require('./configManager');
const { SearchManager } = require('../operations/search/searchManager');
const { R4ArgsParser } = require('../operations/query/r4ArgsParser');

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
     * Fetch the Consent resources for data connection view control
     *
     * When this function is called, it expects that context have been set with
     * person's owner. And this must be ensured before calling this function.
     * @param {{
     *  requestInfo: FhirRequestInfo,
     *  base_version: string,
     *  patientFilterReferences: string[] | null,
     *  raiseErrorForMissingUserOwner: boolean
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
        patientFilterReferences,
        raiseErrorForMissingUserOwner = true
    }) {
        const { personIdFromJwtToken } = requestInfo;

        /**
         * @type {string | null}
         */
        let userOwnerFromContext = httpContext.get(`${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}${personIdFromJwtToken}`);

        if (raiseErrorForMissingUserOwner) {
            assertIsValid(userOwnerFromContext);
        }

        if (
            userOwnerFromContext &&
            !this.configManager.clientsWithDataConnectionViewControl.includes(userOwnerFromContext)
        ) {
            return {
                viewControlResourceToExcludeMap: {},
                viewControlConsentQueries: [],
                viewControlConsentQueryOptions: []
            };
        }

        let resourceType = 'Consent';
        let viewControlResourceToExcludeMap = {};

        let consentArgs = {
            base_version,
            patient: `Patient/person.${personIdFromJwtToken}`,
            category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
        };

        if (patientFilterReferences && patientFilterReferences.length > 0) {
            consentArgs.actor = patientFilterReferences.join(',');
        }

        let {
            entries: viewControlConsentEntries,
            queryItems: viewControlConsentQueries,
            options: viewControlConsentQueryOptions
        } = await this.searchManager.fetchResourcesByArgsAsync({
            resourceType,
            base_version,
            requestInfo,
            explain: false,
            debug: false,
            applyPatientFilter: false,
            parsedArgs: this.r4ArgsParser.parseArgs({
                resourceType,
                args: consentArgs
            })
        });

        viewControlConsentEntries.forEach((entry) => {
            entry.resource.provision?.data?.forEach((ref) => {
                if (ref?.reference?.reference) {
                    const { resourceType: refType, id: refId } = ReferenceParser.parseReference(
                        ref.reference.reference
                    );
                    if (refType && refId) {
                        if (!viewControlResourceToExcludeMap[refType]) {
                            viewControlResourceToExcludeMap[refType] = [];
                        }
                        viewControlResourceToExcludeMap[refType].push(refId);
                    }
                }
            });
        });

        return {
            viewControlResourceToExcludeMap,
            viewControlConsentQueries,
            viewControlConsentQueryOptions
        };
    }

    /**
     * Fetch a Person's dataConnectionViewControl Consents and the resources they hide.
     * Replaces getConsentAsync, which is removed once its callers have moved to
     * PatientDataViewControlExclusion.
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
     *  owner: string|null|undefined,
     *  patientFilterReferences?: string[] | null
     * }}
     * @return {Promise<{
     *  viewControlResourceToExcludeMap: {[resourceType: string]: string[]},
     *  viewControlConsentQueries: QueryItem[],
     *  viewControlConsentQueryOptions: import('mongodb').FindOptions<import('mongodb').DefaultSchema>[]
     * }>}
     */
    async getConsentForPersonAsync({
        requestInfo,
        base_version,
        personId,
        owner,
        patientFilterReferences
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

        let consentArgs = {
            base_version,
            // only an active Consent applies, as in the other Consent lookups; status also lets the
            // query use the {status, patient._uuid} index instead of scanning the collection
            status: 'active',
            patient: `Patient/person.${personId}`,
            category: `${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.SYSTEM}|${CONSENT_CATEGORY.DATA_CONNECTION_VIEW_CONTROL.CODE}`
        };

        if (patientFilterReferences && patientFilterReferences.length > 0) {
            consentArgs.actor = patientFilterReferences.join(',');
        }

        let {
            entries: viewControlConsentEntries,
            queryItems: viewControlConsentQueries,
            options: viewControlConsentQueryOptions
        } = await this.searchManager.fetchResourcesByArgsAsync({
            resourceType,
            base_version,
            requestInfo,
            explain: false,
            debug: false,
            applyPatientFilter: false,
            parsedArgs: this.r4ArgsParser.parseArgs({
                resourceType,
                args: consentArgs
            })
        });

        viewControlConsentEntries.forEach((entry) => {
            entry.resource.provision?.data?.forEach((ref) => {
                if (ref?.reference?.reference) {
                    const { resourceType: refType, id: refId } = ReferenceParser.parseReference(
                        ref.reference.reference
                    );
                    if (refType && refId) {
                        if (!viewControlResourceToExcludeMap[refType]) {
                            viewControlResourceToExcludeMap[refType] = [];
                        }
                        viewControlResourceToExcludeMap[refType].push(refId);
                    }
                }
            });
        });

        return {
            viewControlResourceToExcludeMap,
            viewControlConsentQueries,
            viewControlConsentQueryOptions
        };
    }
}

module.exports = {
    PatientDataViewControlManager
};
