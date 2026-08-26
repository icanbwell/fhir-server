const { BasePostSaveHandler } = require('../../../utils/basePostSaveHandler');
const { assertTypeEquals } = require('../../../utils/assertType');
const { RedisManager } = require('../../../utils/redisManager');
const { ConfigManager } = require('../../../utils/configManager');
const { BwellPersonFinder } = require('../../../utils/bwellPersonFinder');
const { ReferenceParser } = require('../../../utils/referenceParser');
const { isUuid } = require('../../../utils/uid.util');
const { PERSON_PROXY_PREFIX } = require('../../../constants');
const { logDebug, logError } = require('../../../operations/common/logging');

/**
 * Post-save handler that invalidates the Patient/$everything Redis cache whenever a
 * Consent resource is created, updated, or removed.
 *
 * No-ops entirely unless configManager.writeToCacheForEverythingOperation is true (i.e.
 * ENABLE_REDIS && ENABLE_REDIS_CACHE_WRITE_FOR_EVERYTHING_OPERATION) - the same gate
 * everythingHelper.js itself uses before writing to the $everything cache. If that cache is
 * never written to, there is nothing for this handler to invalidate.
 *
 * The $everything cache (see PatientEverythingCacheKeyGenerator) is keyed in part on a
 * "generation" counter stored in Redis (Patient:<uuid>:Everything:Generation or
 * ClientPerson:<uuid>:Everything:Generation). Bumping that counter changes the cache key
 * on the next read, which makes any previously-cached entry unreachable - it is never
 * read again and simply expires later via its normal TTL. No explicit cache delete is
 * required.
 *
 * Without this handler there was NO invalidation trigger at all for the Everything cache
 * on Consent writes, so stale PHI could be served for up to the cache TTL (~600s) after a
 * Consent was revoked or otherwise changed.
 *
 * Proxy-Person coverage: if the Consent's `patient` reference is a direct Patient reference,
 * this handler also (best-effort, via the existing BwellPersonFinder traversals) bumps the
 * ClientPerson:<uuid>:Everything:Generation key for (a) the Person(s) immediately linked to
 * the patient and (b) every Person visited while walking up the link graph to the bwell master
 * Person, including the master Person itself - not just the two endpoints. This covers link
 * graphs deeper than master -> client -> Patient: any intermediate Person an $everything cache
 * could realistically be keyed under (the JWT person the caller authenticated as) is bumped,
 * not only the immediate client Person or the top-of-graph master Person.
 *
 * The traversal adds a bounded per-Consent-write DB cost (the up-graph walk), which is
 * acceptable on this low-frequency write path.
 */
class ConsentCacheInvalidationHandler extends BasePostSaveHandler {
    /**
     * @param {Object} params
     * @param {RedisManager} params.redisManager
     * @param {BwellPersonFinder} params.bwellPersonFinder
     * @param {ConfigManager} params.configManager
     */
    constructor({ redisManager, bwellPersonFinder, configManager }) {
        super();

        /**
         * @type {RedisManager}
         */
        this.redisManager = redisManager;
        assertTypeEquals(redisManager, RedisManager);

        /**
         * @type {BwellPersonFinder}
         */
        this.bwellPersonFinder = bwellPersonFinder;
        assertTypeEquals(bwellPersonFinder, BwellPersonFinder);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Fires whenever a resource is changed. No-ops for anything but Consent.
     * @param {string} requestId
     * @param {string} eventType. Can be C = create, U = update, D = delete
     * @param {string} resourceType
     * @param {Resource} doc
     * @return {Promise<void>}
     */
    async afterSaveAsync({ requestId, eventType, resourceType, doc }) {
        if (resourceType !== 'Consent' || !doc) {
            return;
        }

        if (!this.configManager.writeToCacheForEverythingOperation) {
            return;
        }

        try {
            const patientReference = doc.patient;
            const referenceValue = patientReference && patientReference.reference;
            if (!referenceValue) {
                logDebug('ConsentCacheInvalidationHandler: Consent has no patient reference, skipping cache invalidation', {
                    requestId, consentId: doc.id, eventType
                });
                return;
            }

            const { id: rawId } = ReferenceParser.parseReference(referenceValue);
            if (!rawId) {
                return;
            }

            // Proxy-patient reference (Patient/person.<personUuid>) -> this Consent is about
            // a Person directly, so bump that Person's Everything-cache generation.
            if (rawId.startsWith(PERSON_PROXY_PREFIX)) {
                const personUuid = rawId.replace(PERSON_PROXY_PREFIX, '');
                if (isUuid(personUuid)) {
                    await this.incrementGenerationAsync(`ClientPerson:${personUuid}:Everything:Generation`, {
                        requestId, consentId: doc.id
                    });
                } else {
                    logDebug('ConsentCacheInvalidationHandler: proxy-patient reference did not contain a valid person uuid, skipping', {
                        requestId, consentId: doc.id, referenceValue
                    });
                }
                return;
            }

            // Direct Patient reference. Prefer the pre-save-enriched canonical uuid
            // (doc.patient._uuid, format "Patient/<uuid>") when it is a valid uuid,
            // falling back to the raw reference id otherwise.
            let patientUuid = rawId;
            const enrichedUuidRef = patientReference._uuid;
            if (enrichedUuidRef) {
                const { id: enrichedId } = ReferenceParser.parseReference(enrichedUuidRef);
                if (enrichedId && isUuid(enrichedId)) {
                    patientUuid = enrichedId;
                }
            }

            if (!isUuid(patientUuid)) {
                logDebug('ConsentCacheInvalidationHandler: could not resolve a patient uuid from Consent.patient, skipping cache invalidation', {
                    requestId, consentId: doc.id, referenceValue
                });
                return;
            }

            await this.incrementGenerationAsync(`Patient:${patientUuid}:Everything:Generation`, {
                requestId, consentId: doc.id
            });

            // Best-effort: also bump the ClientPerson-keyed cache for any Person(s) the proxy
            // $everything path could be primed under. That cache is keyed on the Person the caller
            // authenticated as (ClientPerson:<jwtPersonUuid>), which in bwell's link graph could be
            // the immediate client Person (one hop from the patient), the bwell master Person (top
            // of the graph), or any intermediate Person in between. We bump all of them, so a token
            // for any Person along the path is invalidated, not just the two endpoints.
            // Uses existing BwellPersonFinder traversals; the union is deduped so a Person visited
            // by both traversals is bumped once.
            try {
                /**
                 * @type {Set<string>}
                 */
                const personUuidsToBump = new Set();

                const { patientReferenceToPersonUuid } = await this.bwellPersonFinder.getImmediatePersonIdsOfPatientsAsync({
                    patientReferences: [{ id: patientUuid, resourceType: 'Patient' }]
                });
                const linkedPersonUuids = (patientReferenceToPersonUuid && patientReferenceToPersonUuid[patientUuid]) || [];
                for (const personUuid of linkedPersonUuids) {
                    if (personUuid) {
                        personUuidsToBump.add(personUuid);
                    }
                }

                // Walk up the link graph to the bwell master Person, adding every Person visited
                // along the way (not just the master Person at the top) - this is the common
                // JWT-person for the proxy $everything path, and covers link graphs deeper than
                // master -> client -> Patient that the single-hop lookup above misses.
                const personIdsInLinkPath = await this.bwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync({ patientId: patientUuid });
                for (const personUuid of personIdsInLinkPath) {
                    if (personUuid) {
                        personUuidsToBump.add(personUuid);
                    }
                }

                for (const personUuid of personUuidsToBump) {
                    await this.incrementGenerationAsync(`ClientPerson:${personUuid}:Everything:Generation`, {
                        requestId, consentId: doc.id, patientUuid
                    });
                }
            } catch (error) {
                // Best-effort only: failing to find linked Person(s) should not fail the
                // Consent write, which has already been committed by this point.
                logError('ConsentCacheInvalidationHandler: failed to look up linked Person(s) for cache invalidation', {
                    error, requestId, consentId: doc.id, patientUuid
                });
            }
        } catch (error) {
            // Cache invalidation is best-effort: the Consent resource is already
            // committed to MongoDB by the time this handler runs, so a failure here
            // should not fail the write. Worst case, the cache serves stale data until
            // its TTL expires - the same behavior as before this handler existed.
            logError('ConsentCacheInvalidationHandler: failed to invalidate Everything cache for Consent change', {
                error, requestId, consentId: doc && doc.id, resourceType, eventType
            });
        }
    }

    /**
     * Increments the generation counter for the given key, logging (not throwing) on error.
     * @param {string} generationKey
     * @param {Object} logContext
     * @return {Promise<void>}
     */
    async incrementGenerationAsync(generationKey, logContext) {
        try {
            await this.redisManager.incrementGenerationAsync(generationKey);
        } catch (error) {
            logError('ConsentCacheInvalidationHandler: failed to increment Everything cache generation', {
                error, generationKey, ...logContext
            });
        }
    }
}

module.exports = {
    ConsentCacheInvalidationHandler
};
