const { assertTypeEquals, assertIsValid } = require('./assertType');
const { ReferenceParser } = require('../utils/referenceParser');
const { QueryItem } = require('../operations/graph/queryItem');
const { CONSENT_CATEGORY } = require('../constants');
const { SecurityTagSystem } = require('./securityTagSystem');
const { NotFoundError, BadRequestError } = require('./httpErrors');
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
     *  owner: string|null|undefined,
     *  patientFilterReferences?: string[] | null
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

    /**
     * Reads a Person through the caller's normal access filter, for a view-control check whose
     * subject is a Person named in the URL rather than the caller's own.
     *
     * A Person the caller can't see and a Person that doesn't exist get the same NotFoundError, so
     * this can't be used to find out which Persons exist in other tenants.
     * @param {{ requestInfo: FhirRequestInfo, base_version: string, personId: string }}
     * @return {Promise<{ uuid: string, owner: string|undefined }>}
     * @throws {NotFoundError} when no visible Person has this id
     * @throws {BadRequestError} when the id (a source id) matches more than one visible Person
     */
    async findPersonAsync({ requestInfo, base_version, personId }) {
        const resourceType = 'Person';
        const { entries } = await this.searchManager.fetchResourcesByArgsAsync({
            resourceType,
            base_version,
            requestInfo,
            explain: false,
            debug: false,
            parsedArgs: this.r4ArgsParser.parseArgs({
                resourceType,
                args: { base_version, _id: personId }
            })
        });
        if (entries.length === 0) {
            throw new NotFoundError('Person not found');
        }
        if (entries.length > 1) {
            throw new BadRequestError(new Error(
                'The Person id matches more than one Person; use the Person uuid'
            ));
        }
        const person = entries[0].resource;
        const owner = person.meta?.security?.find((tag) => tag?.system === SecurityTagSystem.owner)?.code;
        return { uuid: person._uuid, owner };
    }
}

module.exports = {
    PatientDataViewControlManager
};
