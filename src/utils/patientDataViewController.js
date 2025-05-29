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
}

module.exports = {
    PatientDataViewControlManager
};
