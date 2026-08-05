const { BasePostSaveHandler } = require('../../../utils/basePostSaveHandler');
const { assertTypeEquals } = require('../../../utils/assertType');
const { RedisManager } = require('../../../utils/redisManager');
const { BwellPersonFinder } = require('../../../utils/bwellPersonFinder');
const { ReferenceParser } = require('../../../utils/referenceParser');
const { isUuid } = require('../../../utils/uid.util');
const { PERSON_PROXY_PREFIX } = require('../../../constants');
const { logDebug, logError } = require('../../../operations/common/logging');

/**
 * Post-save handler that invalidates the Patient/$everything Redis cache whenever a
 * Consent resource is created, updated, or removed.
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
 * Known gap: if the Consent's `patient` reference is a direct Patient reference, this
 * handler also does a best-effort lookup (via BwellPersonFinder, an existing traversal
 * utility) for Person(s) immediately linked to that patient and bumps their
 * ClientPerson:<uuid>:Everything:Generation key too, so the proxy-Person $everything path
 * is covered for the common case. This is a single-hop, best-effort lookup - it does not
 * walk the full Person/Patient link graph - so an $everything cache primed under a
 * ClientPerson key that is more than one hop away from this patient will not be
 * invalidated by this handler.
 */
class ConsentCacheInvalidationHandler extends BasePostSaveHandler {
    /**
     * @param {Object} params
     * @param {RedisManager} params.redisManager
     * @param {BwellPersonFinder} params.bwellPersonFinder
     */
    constructor({ redisManager, bwellPersonFinder }) {
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

            // Best-effort: also bump the ClientPerson-keyed cache for any Person(s)
            // immediately linked to this patient (the proxy-Person $everything path).
            // Uses the existing BwellPersonFinder traversal utility - a single hop only.
            try {
                const { patientReferenceToPersonUuid } = await this.bwellPersonFinder.getImmediatePersonIdsOfPatientsAsync({
                    patientReferences: [{ id: patientUuid, resourceType: 'Patient' }]
                });
                const linkedPersonUuids = (patientReferenceToPersonUuid && patientReferenceToPersonUuid[patientUuid]) || [];
                for (const personUuid of linkedPersonUuids) {
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
