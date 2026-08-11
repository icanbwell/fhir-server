'use strict';

/**
 * Unit tests for ConsentCacheInvalidationHandler (DCON-4861, DCON-4893).
 *
 * Focus: the proxy-Person ($everything) cache invalidation on a direct-Patient Consent write
 * bumps the immediate client Person key, every intermediate Person key in the link graph, AND
 * the bwell master Person key, deduped, and is best-effort (a traversal failure never throws
 * out of the handler).
 */

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

const { ConsentCacheInvalidationHandler } = require('../../../../../dataLayer/postSaveHandlers/handlers/consentCacheInvalidationHandler');
const { RedisManager } = require('../../../../../utils/redisManager');
const { BwellPersonFinder } = require('../../../../../utils/bwellPersonFinder');

jest.mock('../../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

const PATIENT_UUID = '11111111-1111-1111-1111-111111111111';
const CLIENT_PERSON_UUID = '22222222-2222-2222-2222-222222222222';
const MASTER_PERSON_UUID = '33333333-3333-3333-3333-333333333333';
const PROXY_PERSON_UUID = '44444444-4444-4444-4444-444444444444';
const INTERMEDIATE_PERSON_UUID = '55555555-5555-5555-5555-555555555555';

describe('ConsentCacheInvalidationHandler', () => {
    let handler;
    let mockRedisManager;
    let mockBwellPersonFinder;
    let bumpedKeys;

    beforeEach(() => {
        bumpedKeys = [];
        mockRedisManager = Object.create(RedisManager.prototype);
        mockRedisManager.incrementGenerationAsync = jest.fn().mockImplementation(async (key) => {
            bumpedKeys.push(key);
        });

        mockBwellPersonFinder = Object.create(BwellPersonFinder.prototype);
        mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync = jest.fn().mockResolvedValue({
            patientReferenceToPersonUuid: { [PATIENT_UUID]: [CLIENT_PERSON_UUID] }
        });
        mockBwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync = jest.fn().mockResolvedValue([
            CLIENT_PERSON_UUID, MASTER_PERSON_UUID
        ]);

        handler = new ConsentCacheInvalidationHandler({
            redisManager: mockRedisManager,
            bwellPersonFinder: mockBwellPersonFinder
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    function directPatientConsent() {
        return {
            id: 'consent-1',
            patient: { reference: `Patient/${PATIENT_UUID}`, _uuid: `Patient/${PATIENT_UUID}` }
        };
    }

    it('is a no-op for non-Consent resources', async () => {
        await handler.afterSaveAsync({ requestId: 'r1', eventType: 'U', resourceType: 'Observation', doc: { id: 'o1' } });
        expect(mockRedisManager.incrementGenerationAsync).not.toHaveBeenCalled();
    });

    it('on a direct-Patient Consent bumps the Patient key, the immediate client Person, AND the bwell master Person', async () => {
        await handler.afterSaveAsync({ requestId: 'r1', eventType: 'U', resourceType: 'Consent', doc: directPatientConsent() });

        expect(bumpedKeys).toContain(`Patient:${PATIENT_UUID}:Everything:Generation`);
        expect(bumpedKeys).toContain(`ClientPerson:${CLIENT_PERSON_UUID}:Everything:Generation`);
        // the master-Person key is the gap this change closes
        expect(bumpedKeys).toContain(`ClientPerson:${MASTER_PERSON_UUID}:Everything:Generation`);
        expect(mockBwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync).toHaveBeenCalledWith({ patientId: PATIENT_UUID });
    });

    it('dedupes when the immediate client Person is also the bwell master Person (bumped once)', async () => {
        mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync.mockResolvedValue({
            patientReferenceToPersonUuid: { [PATIENT_UUID]: [MASTER_PERSON_UUID] }
        });
        mockBwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync.mockResolvedValue([MASTER_PERSON_UUID]);

        await handler.afterSaveAsync({ requestId: 'r1', eventType: 'U', resourceType: 'Consent', doc: directPatientConsent() });

        const masterKey = `ClientPerson:${MASTER_PERSON_UUID}:Everything:Generation`;
        expect(bumpedKeys.filter(k => k === masterKey)).toHaveLength(1);
    });

    it('bumps every intermediate Person in a 3+-hop link graph, not just the two endpoints', async () => {
        // patient -> client Person -> intermediate Person -> bwell master Person
        mockBwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync.mockResolvedValue([
            CLIENT_PERSON_UUID, INTERMEDIATE_PERSON_UUID, MASTER_PERSON_UUID
        ]);

        await handler.afterSaveAsync({ requestId: 'r1', eventType: 'U', resourceType: 'Consent', doc: directPatientConsent() });

        expect(bumpedKeys).toContain(`ClientPerson:${INTERMEDIATE_PERSON_UUID}:Everything:Generation`);
        expect(bumpedKeys).toContain(`ClientPerson:${MASTER_PERSON_UUID}:Everything:Generation`);
        expect(mockBwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync).toHaveBeenCalledWith({ patientId: PATIENT_UUID });
    });

    it('proxy-patient Consent bumps only that Person key and does not run the direct-Patient traversal', async () => {
        const doc = { id: 'consent-2', patient: { reference: `Patient/person.${PROXY_PERSON_UUID}` } };
        await handler.afterSaveAsync({ requestId: 'r1', eventType: 'U', resourceType: 'Consent', doc });

        expect(bumpedKeys).toEqual([`ClientPerson:${PROXY_PERSON_UUID}:Everything:Generation`]);
        expect(mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync).not.toHaveBeenCalled();
        expect(mockBwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync).not.toHaveBeenCalled();
    });

    it('still bumps the Patient key when the Person traversal fails (best-effort, never throws)', async () => {
        mockBwellPersonFinder.getImmediatePersonIdsOfPatientsAsync.mockRejectedValue(new Error('mongo down'));

        await expect(
            handler.afterSaveAsync({ requestId: 'r1', eventType: 'U', resourceType: 'Consent', doc: directPatientConsent() })
        ).resolves.toBeUndefined();

        expect(bumpedKeys).toContain(`Patient:${PATIENT_UUID}:Everything:Generation`);
    });

    it('handles a delete (eventType D) the same way as a write', async () => {
        await handler.afterSaveAsync({ requestId: 'r1', eventType: 'D', resourceType: 'Consent', doc: directPatientConsent() });
        expect(bumpedKeys).toContain(`Patient:${PATIENT_UUID}:Everything:Generation`);
        expect(bumpedKeys).toContain(`ClientPerson:${MASTER_PERSON_UUID}:Everything:Generation`);
    });
});
