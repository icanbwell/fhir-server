const { FilterById } = require('../operations/query/filters/id');
const { assertTypeEquals } = require('./assertType');
const { DatabaseQueryFactory } = require('../dataLayer/databaseQueryFactory');
const { logWarn } = require('../operations/common/logging');
const { PERSON_REFERENCE_PREFIX, HTTP_CONTEXT_KEYS } = require('../constants');
const { SecurityTagSystem } = require('./securityTagSystem');
const httpContext = require('express-http-context');
const { FhirRequestInfo } = require('./fhirRequestInfo');
const { ScopesManager } = require('../operations/security/scopesManager');
const { SecurityTagManager } = require('../operations/common/securityTagManager');
const { ConfigManager } = require('./configManager');

const patientReferencePrefix = 'Patient/';
const personReferencePrefix = 'Person/';
const personProxyPrefix = 'person.';
const patientReferencePlusPersonProxyPrefix = `${patientReferencePrefix}${personProxyPrefix}`;
const maximumRecursionDepth = 4;

/**
 * @param {{meta?: {security?: {system: string, code: string}[]}}} person
 * @return {string|undefined} the resource's owner security tag code, or undefined if it has none
 */
function getOwnerSecurityCode (person) {
    const security = person?.meta?.security;
    if (!security || security.length === 0) {
        return undefined;
    }
    return security.find((tag) => tag.system === SecurityTagSystem.owner)?.code;
}

class PersonToPatientIdsExpander {
    /**
     * constructor
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ScopesManager} scopesManager
     * @param {SecurityTagManager} securityTagManager
     * @param {ConfigManager} configManager
     */
    constructor (
        {
            databaseQueryFactory,
            scopesManager,
            securityTagManager,
            configManager
        }
    ) {
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);

        /**
         * @type {SecurityTagManager}
         */
        this.securityTagManager = securityTagManager;
        assertTypeEquals(securityTagManager, SecurityTagManager);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * replaces patient proxy with actual patient ids
     * @param {string} base_version
     * @param {string|string[]} ids
     * @param {boolean} includePatientPrefix
     * @param {boolean} toMap If return map of person to patient
     * @param {FhirRequestInfo} requestInfo
     * @return {Promise<string|string[]|{[key: string]: string[]}>}
     */
    async getPatientProxyIdsAsync ({ base_version, ids, includePatientPrefix, toMap, requestInfo }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });

        // 1. Get person ids from id
        const personIds = Array.isArray(ids) ? ids.map(id =>
                id.replace(patientReferencePlusPersonProxyPrefix, '').replace(personProxyPrefix, '')
            ) : [
                ids.replace(patientReferencePlusPersonProxyPrefix, '').replace(personProxyPrefix, '')
            ];
        /** @type {Set<string>} */
        const unvisitedPersonIds = new Set(personIds);
        // 2. Get that Person resource from the database
        let patientIds = await this.getPatientIdsFromPersonAsync(
            {
                personIds,
                totalProcessedPersonIds: new Set(),
                databaseQueryManager,
                level: 1,
                toMap,
                returnOriginalPersonId: true, // return the passed personId not its uuid
                requestInfo
            }
        );
        if (!toMap) {
            if (patientIds && patientIds.length > 0) {
                // Also include the proxy patient ID for resources that are associated with the proxy patient directly
                personIds.forEach(personId => patientIds.push(`${personProxyPrefix}${personId}`));
                unvisitedPersonIds.clear();
                if (includePatientPrefix) {
                    patientIds = patientIds.map(p => `${patientReferencePrefix}${p}`);
                }
                // 4. return a csv of those patient ids (remove duplicates)
                return Array.from(new Set(patientIds));
            }
            return ids;
        } else {
            /**
             * @type {Map<string, Set<string>>}
             */
            const personToPatientMap = patientIds;
            /** @type {{[key: string]: string[]}} */
            const plainMap = {};
            for (const [personId, patientIdsSet] of personToPatientMap) {
                unvisitedPersonIds.delete(personId);
                plainMap[`${personId}`] = Array.from(patientIdsSet);

                // Also include the proxy patient Id
                plainMap[`${personId}`].push(`${personProxyPrefix}${personId}`);
                if (includePatientPrefix) {
                    plainMap[`${personId}`] = plainMap[`${personId}`].map((p) => `${patientReferencePrefix}${p}`);
                }
            }

            // there can be personIds, for which person resource doesn't exist.
            // add all these ids
            unvisitedPersonIds.forEach((pId) => {
                const proxyPatient = includePatientPrefix ? `${patientReferencePrefix}${personProxyPrefix}${pId}` : `${personProxyPrefix}${pId}`;
                // if not exist, should reference itself
                if (!plainMap[`${pId}`]) {
                    plainMap[`${pId}`] = [proxyPatient];
                }
            });
            return plainMap;
        }
    }

    /**
     * Get all related patients for the given master-persons.
     * It traverse down to find all patients.
     * @typedef {Object} RelatedPatientParam
     * @property {Set<string>} idsSet
     * @property {boolean} toMap If you want the result as map of id passed to patientIds, then pass it as true
     * @param {RelatedPatientParam} param
     * @returns {Promise<string[] | {[key: string]: string[]}>}
     */
    async getAllRelatedPatients ({ base_version, idsSet, toMap = false }) {
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'Person',
            base_version
        });

        /** @type {string[]} */
        const ids = [];
        idsSet.forEach((person) => {
            ids.push(person.replace(PERSON_REFERENCE_PREFIX, ''));
        });

        const patientIdsOrMap = await this.getPatientIdsFromPersonAsync(
            {
                personIds: [...ids],
                totalProcessedPersonIds: new Set(),
                databaseQueryManager,
                level: 1,
                toMap
            }
        );

        if (toMap === true) {
            /** @type {Map<string, Set<string>>} */
            const patientIdsMap = patientIdsOrMap;
            const plainMap = {};
            for (const [personId, patientIds] of patientIdsMap) {
                plainMap[personId] = Array.from(patientIds);
            }

            return plainMap;
        }
        return patientIdsOrMap;
    }

    /**
     * gets patient ids (recursive) from a person
     * @typedef getPatientIdsFromPersonAsyncArgs
     * @property {string[]} personIds
     * @property {Set} totalProcessedPersonIds
     * @property {DatabaseQueryManager} databaseQueryManager
     * @property {number} level
     * @property {boolean} toMap If passed, will return a map of personId -> all related personIds
     * @property {boolean} returnOriginalPersonId If true then returns original personId passed. By default returns person _uuid
     * @property {boolean} addPersonOwnerToContext If true then add person owner to context
     * @property {FhirRequestInfo} requestInfo
     * @property {Map<string, string>} [parentOwnerTagByPersonId] Maps a personId being fetched at this
     * level to the owner security tag of the Person whose link led us here. Used to detect a
     * Person.link hop that never leaves the requester's own tenant.
     *
     * @param {getPatientIdsFromPersonAsyncArgs}
     * @return {Promise<string[] | Map<string, Set<string>>>} Will return an array if toMap is false else return an map. By default toMap is false
     */
    async getPatientIdsFromPersonAsync ({
        personIds, totalProcessedPersonIds, databaseQueryManager, level, toMap = false, returnOriginalPersonId = false, addPersonOwnerToContext = false, requestInfo, parentOwnerTagByPersonId
    }) {
        /**
         * Final result to return
         * Stores all linked patient to current person
         * @type {Map<string, Set<string>>}
         */
        const personToLinkedPatient = new Map();

        // meta.security is always needed (not just when addPersonOwnerToContext is set) so that
        // getOwnerSecurityCode can compare each fetched Person's owner tag against the tag of
        // whoever linked to it, to detect a same-tenant Person.link hop.
        const projectionsMap = { id: 1, link: 1, _id: 0, _uuid: 1, _sourceId: 1, meta: 1 }

        let query = FilterById.getListFilter(personIds);

        // Apply the caller's access-scope security tag filter to the requested Person so that
        // linked patients are not resolved for a Person the caller cannot access.
        if (
            requestInfo &&
            this.configManager.enableProxyPersonScopeCheckForEverything &&
            requestInfo.originalUrl?.includes('$everything') &&
            requestInfo.method === 'GET'
        ) {
            const { user, scope } = requestInfo;
            const resourceType = 'Person';
            const accessViaPatientScopes = this.scopesManager.isAccessAllowedByPatientScopes({ scope, resourceType });

            /**
             * @type {string[]}
             */
            const securityTags = this.securityTagManager.getSecurityTagsFromScope({
                accessRequested: 'read',
                user,
                scope,
                accessViaPatientScopes
            });

            query = this.securityTagManager.getQueryWithSecurityTags({
                resourceType,
                securityTags,
                query,
                useAccessIndex: this.configManager.useAccessIndex,
                useHistoryTable: false
            });
        }

        /**
         * Stores linked person to all base person
         * @type {Map<string, Set<string>>}
         */

        const personResourceCursor = await databaseQueryManager.findAsync(
            {
                query,
                options: { projection: projectionsMap }
            }
        );
        /**
         * @type {string[]}
         */
        let patientIds = [];
        let personIdsToRecurse = [];
        /**
         * Owner security tag of the Person being expanded, keyed by the personId of each of
         * ITS linked Persons - passed to the next recursion level so it can tell whether that
         * hop stayed within the same tenant.
         * @type {Map<string, string>}
         */
        const nextLevelParentOwnerTagByPersonId = new Map();
        while (await personResourceCursor.hasNext()) {
            const person = await personResourceCursor.nextObject();
            let personId = person._uuid;

            const currentOwnerTag = getOwnerSecurityCode(person);
            const parentOwnerTag = parentOwnerTagByPersonId?.get(person._uuid);
            const isSameTenantHopFromParent = parentOwnerTag !== undefined && parentOwnerTag === currentOwnerTag;

            // at first call only, returnOriginalPersonId can be true so that we return the id map for passed personIds not their uuids
            // also, this is only have significance when we want to return map
            if (returnOriginalPersonId && toMap) {
                personId = personIds.find((id) => id === person._uuid || id === person._sourceId);
            }

            if (addPersonOwnerToContext && person.meta && person.meta.security && person.meta.security.length > 0) {
                person.meta.security.forEach((security) => {
                    if (security.system === SecurityTagSystem.owner) {
                        httpContext.set(
                            `${HTTP_CONTEXT_KEYS.PERSON_OWNER_PREFIX}${personId}`,
                            security.code
                        );
                    }
                });
            }

            // A Person reached only via a Person.link hop that never leaves the tenant of
            // whoever linked to it is a duplicate/sibling account, not the legitimate
            // cross-org consolidation case (see RNGR-38) - treat it as a dead end: don't
            // surface its own proxy patient or linked patients, and don't recurse into its
            // own Person links.
            if (isSameTenantHopFromParent) {
                continue;
            }

            patientIds.push(`${personProxyPrefix}${personId}`);
            const uuidKey = '_uuid';

            if (person && person.link && person.link.length > 0 && !totalProcessedPersonIds.has(personId)) {
                const linkedPatients = personToLinkedPatient.get(personId) || new Set();

                const patientIdsToAdd = person.link
                    .filter(l => l.target && l.target[`${uuidKey}`] &&
                        (l.target[`${uuidKey}`].startsWith(patientReferencePrefix) || l.target.type === 'Patient'))
                    .map(l => {
                        const patientId = l.target[`${uuidKey}`].replace(patientReferencePrefix, '');
                        if (toMap === true) {
                            // add linked patient id to the person
                            linkedPatients.add(patientId);
                        }
                        return patientId;
                    });

                patientIds = patientIds.concat(patientIdsToAdd);

                const personResourceWithPersonReferenceLink = person.link
                    .filter(l => l.target && l.target[`${uuidKey}`] &&
                        (l.target[`${uuidKey}`].startsWith(personReferencePrefix) || l.target.type === 'Person'))
                    .map(l => {
                        const linkedPersonId = l.target[`${uuidKey}`].replace(personReferencePrefix, '');
                        return linkedPersonId;
                    });

                personIdsToRecurse = personIdsToRecurse.concat(personResourceWithPersonReferenceLink);
                personResourceWithPersonReferenceLink.forEach((linkedPersonId) => {
                    nextLevelParentOwnerTagByPersonId.set(linkedPersonId, currentOwnerTag);
                });

                // finally update the sets
                personToLinkedPatient.set(personId, linkedPatients);
            }
        }

        if (level === maximumRecursionDepth) {
            const message = `Maximum recursion depth of ${maximumRecursionDepth} reached while recursively fetching patient ids from person links`;
            logWarn(message, { patientIds, personIdsToRecurse, totalProcessedPersonIds: [...totalProcessedPersonIds] });
            if (toMap) {
                return personToLinkedPatient;
            }
            return patientIds;
        }
        if (level < maximumRecursionDepth && personIdsToRecurse.length !== 0) {
            // avoid infinite loop
            if (toMap === true) {
                /**
                * @type {Map<string, Set<string>>}
                */
                const linkedPeronToPatientIdsMap = await this.getPatientIdsFromPersonAsync({
                    personIds: personIdsToRecurse,
                    totalProcessedPersonIds: new Set([...totalProcessedPersonIds, ...personIds]),
                    databaseQueryManager,
                    level: level + 1,
                    toMap,
                    returnOriginalPersonId: false, // always return _uuid map for it
                    requestInfo,
                    parentOwnerTagByPersonId: nextLevelParentOwnerTagByPersonId
                });

                // add all patients to current person
                for (const [linkedPerson, linkedPatients] of linkedPeronToPatientIdsMap) {
                    personToLinkedPatient.set(linkedPerson, linkedPatients);
                }

                // finally return the result
                return personToLinkedPatient;
            }

            /**
             * @type {string[]}
             */
            const patientIdsFromPersons = await this.getPatientIdsFromPersonAsync({
                personIds: personIdsToRecurse,
                totalProcessedPersonIds: new Set([...totalProcessedPersonIds, ...personIds]),
                databaseQueryManager,
                level: level + 1,
                toMap,
                requestInfo,
                parentOwnerTagByPersonId: nextLevelParentOwnerTagByPersonId
            });
            return patientIds.concat(patientIdsFromPersons);
        }

        return toMap === true ? personToLinkedPatient : patientIds;
    }
}

module.exports = {
    PersonToPatientIdsExpander
};
