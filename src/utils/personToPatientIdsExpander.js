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
     * @param {boolean} captureOwnerVerifiedLinks see getPatientIdsFromPersonAsync's JSDoc. Only
     *   meaningful when toMap is true; changes this function's return shape (see below).
     * @return {Promise<string|string[]|{[key: string]: string[]}|{plainMap: {[key: string]: string[]}, ownerVerifiedPersonToLinkedPatients: Map<string, Set<string>>}>}
     *   Returns {plainMap, ownerVerifiedPersonToLinkedPatients} when toMap and
     *   captureOwnerVerifiedLinks are both true; otherwise unchanged existing behavior.
     */
    async getPatientProxyIdsAsync ({ base_version, ids, includePatientPrefix, toMap, requestInfo, captureOwnerVerifiedLinks = false }) {
        // captureOwnerVerifiedLinks only makes sense with toMap: true, because that's the only
        // case that returns the {personToLinkedPatient, ownerVerifiedPersonToLinkedPatients}
        // shape. If both flags are not set correctly, throw rather than silently returning
        // wrong data.
        if (captureOwnerVerifiedLinks && !toMap) {
            throw new Error('captureOwnerVerifiedLinks may only be combined with toMap: true');
        }

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
        const rawResult = await this.getPatientIdsFromPersonAsync(
            {
                personIds,
                totalProcessedPersonIds: new Set(),
                databaseQueryManager,
                level: 1,
                toMap,
                returnOriginalPersonId: true, // return the passed personId not its uuid
                requestInfo,
                captureOwnerVerifiedLinks
            }
        );
        const ownerVerifiedPersonToLinkedPatients = captureOwnerVerifiedLinks
            ? rawResult.ownerVerifiedPersonToLinkedPatients
            : undefined;
        let patientIds = captureOwnerVerifiedLinks ? rawResult.personToLinkedPatient : rawResult;

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
            return captureOwnerVerifiedLinks
                ? { plainMap, ownerVerifiedPersonToLinkedPatients }
                : plainMap;
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
     * @property {boolean} captureOwnerVerifiedLinks If true, additionally computes (from the same
     *   query/documents already being read -- no new Mongo round trip) which visited Persons have
     *   an owner tag (SecurityTagSystem.owner) matching the caller's securityTags, and returns that
     *   as a second map alongside the existing result. This is a materially different, narrower
     *   check than the existing access-tag filter above: owner declares the single authoritative
     *   tenant for a resource, while access declares who may merely read it. See
     *   docs/superpowers/specs/2026-08-08-proa-person-everything-caching-design.md §2 for why PROA
     *   consent-sharing eligibility needs the owner check specifically. Only meaningful when
     *   `toMap` is true; when true, changes this function's return shape (see below).
     * @property {FhirRequestInfo} requestInfo
     *
     * @param {getPatientIdsFromPersonAsyncArgs}
     * @return {Promise<string[] | Map<string, Set<string>> | {personToLinkedPatient: Map<string, Set<string>>, ownerVerifiedPersonToLinkedPatients: Map<string, Set<string>>}>}
     *   Returns an array if toMap is false. Returns a bare Map if toMap is true and
     *   captureOwnerVerifiedLinks is false/omitted (unchanged existing behavior for all current
     *   callers). Returns {personToLinkedPatient, ownerVerifiedPersonToLinkedPatients} if toMap and
     *   captureOwnerVerifiedLinks are both true.
     */
    async getPatientIdsFromPersonAsync ({
        personIds, totalProcessedPersonIds, databaseQueryManager, level, toMap = false, returnOriginalPersonId = false, addPersonOwnerToContext = false, requestInfo, captureOwnerVerifiedLinks = false
    }) {
        /**
         * Final result to return
         * Stores all linked patient to current person
         * @type {Map<string, Set<string>>}
         */
        const personToLinkedPatient = new Map();

        /**
         * person._uuid -> Set of full "Patient/<uuid>" reference strings, for Persons whose owner
         * tag matches securityTagsForOwnerCheck. Always keyed by _uuid (never
         * returnOriginalPersonId) so it matches BwellPersonFinder.getImmediatePersonIdsOfPatientsAsync's
         * personToLinkedPatientsMap shape exactly. Populated only when captureOwnerVerifiedLinks is
         * true and the security-check block below actually runs.
         * @type {Map<string, Set<string>>}
         */
        const ownerVerifiedPersonToLinkedPatients = new Map();

        const projectionsMap = { id: 1, link: 1, _id: 0, _uuid: 1, _sourceId: 1 }

        if(addPersonOwnerToContext || captureOwnerVerifiedLinks) {
            projectionsMap.meta = 1
        }

        let query = FilterById.getListFilter(personIds);

        /**
         * securityTags used for the existing access-tag check, captured here (rather than only
         * inside the `if` block below) so captureOwnerVerifiedLinks can reuse the same value for
         * its owner-tag check without a second computation. null when the security-check
         * condition below never fires (e.g. enableProxyPersonScopeCheckForEverything is off) --
         * captureOwnerVerifiedLinks intentionally produces an empty ownerVerifiedPersonToLinkedPatients
         * in that case rather than a partially-checked one.
         * @type {string[]|null}
         */
        let securityTagsForOwnerCheck = null;

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
            securityTagsForOwnerCheck = securityTags;

            query = this.securityTagManager.getQueryWithSecurityTags({
                resourceType,
                securityTags,
                query,
                useAccessIndex: this.configManager.useAccessIndex,
                useHistoryTable: false
            });
        }

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

                if (captureOwnerVerifiedLinks && securityTagsForOwnerCheck !== null) {
                    const ownerTag = person.meta?.security?.find(
                        (s) => s.system === SecurityTagSystem.owner
                    )?.code;
                    if (ownerTag && securityTagsForOwnerCheck.includes(ownerTag)) {
                        // patientIdsToAdd (above) already scanned person.link with this exact
                        // predicate and stripped the prefix -- reuse it instead of re-filtering.
                        const linkedPatientRefs = patientIdsToAdd.map(
                            (patientId) => `${patientReferencePrefix}${patientId}`
                        );
                        if (linkedPatientRefs.length > 0) {
                            ownerVerifiedPersonToLinkedPatients.set(person._uuid, new Set(linkedPatientRefs));
                        }
                    }
                }
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

        const buildToMapReturn = () => captureOwnerVerifiedLinks
            ? { personToLinkedPatient, ownerVerifiedPersonToLinkedPatients }
            : personToLinkedPatient;

        if (level === maximumRecursionDepth) {
            const message = `Maximum recursion depth of ${maximumRecursionDepth} reached while recursively fetching patient ids from person links`;
            logWarn(message, { patientIds, personIdsToRecurse, totalProcessedPersonIds: [...totalProcessedPersonIds] });
            if (toMap) {
                return buildToMapReturn();
            }
            return patientIds;
        }
        if (level < maximumRecursionDepth && personIdsToRecurse.length !== 0) {
            // avoid infinite loop
            if (toMap === true) {
                const recursiveResult = await this.getPatientIdsFromPersonAsync({
                    personIds: personIdsToRecurse,
                    totalProcessedPersonIds: new Set([...totalProcessedPersonIds, ...personIds]),
                    databaseQueryManager,
                    level: level + 1,
                    toMap,
                    returnOriginalPersonId: false, // always return _uuid map for it
                    requestInfo,
                    captureOwnerVerifiedLinks
                });

                /**
                * @type {Map<string, Set<string>>}
                */
                const linkedPeronToPatientIdsMap = captureOwnerVerifiedLinks
                    ? recursiveResult.personToLinkedPatient
                    : recursiveResult;

                // add all patients to current person
                for (const [linkedPerson, linkedPatients] of linkedPeronToPatientIdsMap) {
                    personToLinkedPatient.set(linkedPerson, linkedPatients);
                }

                if (captureOwnerVerifiedLinks) {
                    for (const [personUuid, patientRefs] of recursiveResult.ownerVerifiedPersonToLinkedPatients) {
                        ownerVerifiedPersonToLinkedPatients.set(personUuid, patientRefs);
                    }
                }

                // finally return the result
                return buildToMapReturn();
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
                requestInfo
            });
            return patientIds.concat(patientIdsFromPersons);
        }

        return toMap === true ? buildToMapReturn() : patientIds;
    }
}

module.exports = {
    PersonToPatientIdsExpander
};
