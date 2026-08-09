const { FilterById } = require('../operations/query/filters/id');
const { assertTypeEquals, assertIsValid } = require('./assertType');
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
     * @param {boolean} addTopPersonAccessCheck if true, adds an access tag check for every Person
     *   resolved during traversal (the top-level id and every id reached via Person.link), not just
     *   the top-level id -- a caller must hold a matching access tag at every hop, since a shared
     *   link graph (e.g. a Main Person hub) can span multiple tenants
     * @return {Promise<string|string[]|{[key: string]: string[]}>}
     */
    async getPatientProxyIdsAsync ({ base_version, ids, includePatientPrefix, toMap, requestInfo, addTopPersonAccessCheck = false }) {
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
                requestInfo,
                addTopPersonAccessCheck
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
     * @property {boolean} addTopPersonAccessCheck If true, applies the access tag check while
     *   walking Person.link -- propagated through each recursive call so a caller can't bypass it
     *   via a Person reached transitively. Applies at every level, including level 1, unless that
     *   level-1 lookup is instead anchored by personIdFromJwtToken (see below).
     * @property {string} [personIdFromJwtToken] The trusted person-id claim from the caller's JWT
     *   (patientScopeManager's personIdFromJwtToken), present only when this traversal starts from
     *   a patient-scoped caller's own identity. When set, level 1 skips the scope-derived
     *   access-tag check entirely -- a patient-scoped token frequently carries no access/ codes at
     *   all (see securityTagManager's accessViaPatientScopes short-circuit), which would make that
     *   check a silent no-op anyway -- and instead verifies identity directly: the level-1 query
     *   matches strictly on the Person's `_uuid` field, never falling back to a `_sourceId` match
     *   the way the generic id filter would for a non-uuid value. Source ids are not guaranteed
     *   unique across tenants, so a sourceId-based match here could otherwise resolve the claim to
     *   a different tenant's Person that merely happens to share the same source id. This only
     *   applies at level 1; Person(s) reached via Person.link (level 2+) always go through the
     *   normal access-tag check below when addTopPersonAccessCheck is set, regardless of
     *   personIdFromJwtToken. Callers whose level-1 personIds are NOT a trusted JWT claim (e.g.
     *   accessHistory's $access-history id, or a person.<id> proxy-patient search parameter) leave
     *   this unset, so the access-tag check runs at level 1 too, same as every other level.
     * @property {FhirRequestInfo} requestInfo
     *
     * @param {getPatientIdsFromPersonAsyncArgs}
     * @return {Promise<string[] | Map<string, Set<string>>>} Will return an array if toMap is false else return an map. By default toMap is false
     */
    async getPatientIdsFromPersonAsync({
        personIds,
        totalProcessedPersonIds,
        databaseQueryManager,
        level,
        toMap = false,
        returnOriginalPersonId = false,
        addPersonOwnerToContext = false,
        requestInfo,
        addTopPersonAccessCheck = false,
        personIdFromJwtToken
    }) {
        /**
         * Final result to return
         * Stores all linked patient to current person
         * @type {Map<string, Set<string>>}
         */
        const personToLinkedPatient = new Map();

        const projectionsMap = { id: 1, link: 1, _id: 0, _uuid: 1, _sourceId: 1 }

        if(addPersonOwnerToContext) {
            projectionsMap.meta = 1
        }

        if(addTopPersonAccessCheck) {
            assertIsValid(requestInfo !== undefined, 'requestInfo is undefined');
        }

        /**
         * @type {import('mongodb').Document}
         */
        let query;

        if (level === 1 && personIdFromJwtToken) {
            // Trusted JWT identity anchor: resolve strictly by the Person collection's _uuid
            // field. Do NOT reuse FilterById.getListFilter here -- for a non-uuid value it falls
            // back to a _sourceId match, and source ids are not guaranteed unique across tenants,
            // so that could resolve the claim to a different tenant's Person that merely happens
            // to share the same source id. A scope-derived access-tag check is not applied here
            // either, since it's frequently a no-op for patient-scoped callers anyway (see below).
            query = { _uuid: { $in: personIds } };
        } else {
            query = FilterById.getListFilter(personIds);

            // Apply the caller's access-scope security tag filter to the requested Person so that
            // linked patients are not resolved for a Person the caller cannot access. This runs at
            // every level, including level 1, for any personIds not anchored by
            // personIdFromJwtToken above -- e.g. accessHistory's $access-history id parameter, or
            // a person.<id> proxy-patient search parameter -- since those come from user/URL
            // input that must be checked just like a direct-by-id fetch would be.
            //
            // NOTE: for a pure patient-scope token (no access/ scope at all -- the normal shape for a
            // plain patient-facing app), getSecurityTagsFromScope() below legitimately returns []
            // (accessViaPatientScopes short-circuits the "no access codes" error), which makes
            // getQueryWithSecurityTags() a complete no-op: no filter is added at all (see review.md §D,
            // "no restriction" must not be indistinguishable from "no matches"). That means this check
            // does NOT protect a pure patient-scope caller from a cross-tenant Person.link today. An
            // owner-tag same-tenant check was evaluated as a fallback for that case and rejected: this
            // data model's Main-Person-to-Client-Person links are *intentionally* cross-tenant by design
            // (see review.md §1 and e.g. src/tests/patientScope/search_with_duplicate_patient_id.person_scope_uuid),
            // so "different owner tag" cannot be used to distinguish a legitimate identity-matched link
            // from a malicious/corrupted one -- doing so breaks that core feature. This gap is tracked by
            // the (quarantined) tests in personToPatientIdsExpander.pureScopeCrossTenant.bugs.test.js
            // pending a real fix (see jest.config.js).
            if (requestInfo && addTopPersonAccessCheck) {
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
        while (await personResourceCursor.hasNext()) {
            const person = await personResourceCursor.nextObject();
            let personId = person._uuid;
            patientIds.push(`${personProxyPrefix}${personId}`);
            // at first call only, returnOriginalPersonId can be true so that we return the id map for passed personIds not their uuids
            // also, this is only have significance when we want to return map
            if (returnOriginalPersonId && toMap) {
                personId = personIds.find((id) => id === person._uuid || id === person._sourceId);
            }
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

                // finally update the sets
                personToLinkedPatient.set(personId, linkedPatients);
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
                    addTopPersonAccessCheck
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
                addTopPersonAccessCheck
            });
            return patientIds.concat(patientIdsFromPersons);
        }

        return toMap === true ? personToLinkedPatient : patientIds;
    }
}

module.exports = {
    PersonToPatientIdsExpander
};
