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
const {
    meetsMinimumAssurance,
    isRecognizedAssuranceLevel,
    DEFAULT_ASSURANCE_MINIMUM_LEVEL
} = require('./personLinkAssuranceLevel');

const patientReferencePrefix = 'Patient/';
const personReferencePrefix = 'Person/';
const personProxyPrefix = 'person.';
const patientReferencePlusPersonProxyPrefix = `${patientReferencePrefix}${personProxyPrefix}`;
const maximumRecursionDepth = 4;

/**
 * DCON-4894 helper: resolves the configured Person.link assurance minimum, falling back to
 * DEFAULT_ASSURANCE_MINIMUM_LEVEL (and logging a warning) if it is not a recognized
 * identity-assuranceLevel code -- an unrecognized minimum would otherwise rank 0 (same as a
 * missing assurance), silently making both the dry-run logging and the enforcement gate a no-op.
 * @param {string} configuredMinimumLevel
 * @return {string}
 */
function resolvePersonLinkAssuranceMinimumLevel (configuredMinimumLevel) {
    if (isRecognizedAssuranceLevel(configuredMinimumLevel)) {
        return configuredMinimumLevel;
    }
    logWarn(
        'configManager.personLinkAssuranceMinimumLevel is not a recognized identity-assuranceLevel code; falling back to the default',
        { configuredMinimumLevel, fallbackMinimumLevel: DEFAULT_ASSURANCE_MINIMUM_LEVEL }
    );
    return DEFAULT_ASSURANCE_MINIMUM_LEVEL;
}

/**
 * DCON-4894 helper: classifies each Person.link entry by whether its target is actually a
 * Patient/Person -- the only target types ever followed by patientIdsToAdd/
 * personResourceWithPersonReferenceLink below (Practitioner/RelatedPerson targets are legal per
 * FHIR R4 but never followed) -- and whether it meets the given assurance minimum. Computed once
 * per link so both the dry-run logging and the enforcement gate can reuse the same result instead
 * of each independently recomputing meetsMinimumAssurance.
 * @param {Object[]} links
 * @param {string} minimumLevel
 * @param {string} uuidKey
 * @return {{link: Object, targetUuid: (string|undefined), isPatientOrPersonTarget: boolean, passesAssurance: boolean}[]}
 */
function classifyPersonLinksByAssurance ({ links, minimumLevel, uuidKey }) {
    return links.map(l => {
        const targetUuid = l.target && l.target[`${uuidKey}`];
        const isPatientOrPersonTarget = !!targetUuid && !!l.target && (
            targetUuid.startsWith(patientReferencePrefix) || l.target.type === 'Patient' ||
            targetUuid.startsWith(personReferencePrefix) || l.target.type === 'Person'
        );
        return {
            link: l,
            targetUuid,
            isPatientOrPersonTarget,
            passesAssurance: meetsMinimumAssurance({ assurance: l.assurance, minimumLevel })
        };
    });
}

/**
 * DCON-4894 helper: logs a dry-run warning for every classified link that is actually followable
 * (Patient/Person target) but below the configured assurance minimum. Purely observational --
 * does not change which links are followed.
 * @param {ReturnType<typeof classifyPersonLinksByAssurance>} linkAssuranceInfo
 * @param {string} personId
 * @param {string} minimumLevel
 */
function logBelowMinimumAssuranceLinks ({ linkAssuranceInfo, personId, minimumLevel }) {
    linkAssuranceInfo
        .filter(info => info.isPatientOrPersonTarget && !info.passesAssurance)
        .forEach(info => {
            const targetId = info.targetUuid
                .replace(patientReferencePrefix, '')
                .replace(personReferencePrefix, '');
            logWarn(
                'Person.link followed below configured assurance minimum (dry-run, no enforcement)',
                { personId, targetId, assurance: info.link.assurance, minimumLevel }
            );
        });
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
     * @param {FhirRequestInfo} requestInfo Required -- adds an access tag check for every Person
     *   resolved during traversal (the top-level id and every id reached via Person.link), not
     *   just the top-level id -- a caller must hold a matching access tag at every hop, since a
     *   shared link graph (e.g. a Main Person hub) can span multiple tenants. Both real callers
     *   (accessHistory.js, patientProxyQueryRewriter.js) are now guaranteed to supply a real
     *   requestInfo from every entry point that can reach them (REST via fhirOperationsManager.js,
     *   GraphQL v1 via context.fhirRequestInfo, GraphQL v2 via this.requestInfo -- all asserted
     *   non-undefined at their own construction), so a missing requestInfo here means a new
     *   caller was wired up without that guarantee, not a legitimate degraded-mode case.
     * @param {boolean} captureOwnerVerifiedLinks see getPatientIdsFromPersonAsync's JSDoc. Only
     *   meaningful when toMap is true; changes this function's return shape (see below).
     * @return {Promise<string|string[]|{[key: string]: string[]}|{plainMap: {[key: string]: string[]}, ownerVerifiedPersonToLinkedPatients: Map<string, Set<string>>}>}
     *   Returns {plainMap, ownerVerifiedPersonToLinkedPatients} when toMap and
     *   captureOwnerVerifiedLinks are both true; otherwise unchanged existing behavior.
     */
    async getPatientProxyIdsAsync ({ base_version, ids, includePatientPrefix, toMap, requestInfo, captureOwnerVerifiedLinks = false }) {
        assertIsValid(requestInfo !== undefined, 'requestInfo is required for getPatientProxyIdsAsync');

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
     * @property {FhirRequestInfo} [requestInfo] Whenever supplied, applies the access-scope check
     *   -- propagated through each recursive call so a caller can't bypass it via a Person reached
     *   transitively. Omit requestInfo to skip the check entirely (e.g. a caller with no
     *   request/scope context to check against).
     *
     * A patient-scoped caller (requestInfo.scope carries a patient/ scope per
     * scopesManager.hasPatientScope) is restricted to ONLY ever resolving their own Person -- i.e.
     * personIds must match requestInfo.personIdFromJwtToken -- resolved strictly by the Person
     * collection's `_uuid` field (never falling back to a `_sourceId` match the way the generic id
     * filter would for a non-uuid value, since source ids are not guaranteed unique across tenants
     * and could otherwise resolve the claim to a different tenant's Person sharing the same source
     * id). This applies at EVERY level, including Person(s) reached via Person.link (level 2+): a
     * patient-scoped caller cannot traverse beyond their own Person at all, even to a Client Person
     * reached from their own Main Person.
     * @property {boolean} captureOwnerVerifiedLinks If true, additionally computes (from the same
     *   query/documents already being read -- no new Mongo round trip) which visited Persons have
     *   an owner tag (SecurityTagSystem.owner) matching the caller's securityTags, and returns that
     *   as a second map alongside the existing result. This is a materially different, narrower
     *   check than the existing access-tag filter above: owner declares the single authoritative
     *   tenant for a resource, while access declares who may merely read it. See
     *   docs/superpowers/specs/2026-08-08-proa-person-everything-caching-design.md §2 for why PROA
     *   consent-sharing eligibility needs the owner check specifically. Only meaningful when
     *   `toMap` is true; when true, changes this function's return shape (see below).
     *
     * @param {getPatientIdsFromPersonAsyncArgs}
     * @return {Promise<string[] | Map<string, Set<string>> | {personToLinkedPatient: Map<string, Set<string>>, ownerVerifiedPersonToLinkedPatients: Map<string, Set<string>>}>}
     *   Returns an array if toMap is false. Returns a bare Map if toMap is true and
     *   captureOwnerVerifiedLinks is false/omitted (unchanged existing behavior for all current
     *   callers). Returns {personToLinkedPatient, ownerVerifiedPersonToLinkedPatients} if toMap and
     *   captureOwnerVerifiedLinks are both true.
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
        captureOwnerVerifiedLinks = false
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
         * true and the access-scope branch below actually computed securityTags.
         * @type {Map<string, Set<string>>}
         */
        const ownerVerifiedPersonToLinkedPatients = new Map();

        const projectionsMap = { id: 1, link: 1, _id: 0, _uuid: 1, _sourceId: 1 }

        if(addPersonOwnerToContext || captureOwnerVerifiedLinks) {
            projectionsMap.meta = 1
        }

        const resourceType = 'Person';
        const hasPatientScope = Boolean(requestInfo?.scope && this.scopesManager.hasPatientScope({ scope: requestInfo.scope }));

        /**
         * securityTags used for the access-tag check below, captured here (rather than only inside
         * that branch) so captureOwnerVerifiedLinks can reuse the same value for its owner-tag
         * check without a second computation. Stays null when securityTags are never computed --
         * i.e. when requestInfo is absent, or when the caller is patient-scoped (that branch gates
         * on the caller's own Person _uuid instead of on access tags, so there is no scope-derived
         * tag set to compare an owner tag against). captureOwnerVerifiedLinks intentionally
         * produces an empty ownerVerifiedPersonToLinkedPatients in those cases rather than a
         * partially-checked one.
         * @type {string[]|null}
         */
        let securityTagsForOwnerCheck = null;

        /**
         * @type {import('mongodb').Document}
         */
        let query = FilterById.getListFilter(personIds);

        if (hasPatientScope) {
            // A patient-scoped caller must resolve to exactly their own Person --
            // never anyone else's, regardless of entry point.
            const jwtPersonId = requestInfo?.personIdFromJwtToken;
            query = {
                $and: [
                    query,
                    jwtPersonId ? { _uuid: jwtPersonId } : { _uuid: '__invalid__' }
                ]
            };
        } else {
            // Apply the caller's access-scope security tag filter to the requested Person so that
            // linked patients are not resolved for a Person the caller cannot access.
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
            if (requestInfo) {
                const { user, scope } = requestInfo;

                /**
                 * @type {string[]}
                 */
                const securityTags = this.securityTagManager.getSecurityTagsFromScope({
                    accessRequested: 'read',
                    user,
                    scope,
                    accessViaPatientScopes: hasPatientScope
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

                // DCON-4894: Person.link.assurance-aware traversal. Commit A (dry-run logging,
                // gated behind logPersonLinkAssuranceBelowMinimum) and Commit B (enforcement,
                // gated behind enforcePersonLinkAssuranceMinimum) both need, per link: whether
                // its target is actually a Patient/Person (the only target types ever followed
                // below -- Practitioner/RelatedPerson targets are legal per FHIR R4 but never
                // contribute to patientIdsToAdd/personResourceWithPersonReferenceLink, so a
                // below-minimum warning for one of those would describe a link that was never
                // going to be followed regardless of assurance) and whether it meets the
                // configured minimum. Both flags default to false; when both happen to be on
                // (e.g. running enforcement live while still observing the dry-run logs), this
                // computes each link's assurance/target-type classification exactly once and
                // reuses it for both purposes, rather than each flag's block redoing it
                // independently.
                let linksToFollow = person.link;
                if (this.configManager.logPersonLinkAssuranceBelowMinimum ||
                    this.configManager.enforcePersonLinkAssuranceMinimum) {
                    const minimumLevel = resolvePersonLinkAssuranceMinimumLevel(
                        this.configManager.personLinkAssuranceMinimumLevel
                    );
                    const linkAssuranceInfo = classifyPersonLinksByAssurance({
                        links: person.link, minimumLevel, uuidKey
                    });

                    if (this.configManager.logPersonLinkAssuranceBelowMinimum) {
                        logBelowMinimumAssuranceLinks({ linkAssuranceInfo, personId, minimumLevel });
                    }

                    // DCON-4894 Commit B: when on, a Person.link below the configured assurance
                    // minimum is excluded from being followed at all -- it contributes neither to
                    // patientIdsToAdd nor to personResourceWithPersonReferenceLink below, so it is
                    // never returned and (if it targets a Person) never recursed into. The logging
                    // above fires unconditionally (regardless of this flag) so operators can see
                    // what's actively being excluded once enforcement is on, not just what would
                    // have been excluded.
                    if (this.configManager.enforcePersonLinkAssuranceMinimum) {
                        linksToFollow = linkAssuranceInfo
                            .filter(info => info.passesAssurance)
                            .map(info => info.link);
                    }
                }

                const patientIdsToAdd = linksToFollow
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

                const personResourceWithPersonReferenceLink = linksToFollow
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
