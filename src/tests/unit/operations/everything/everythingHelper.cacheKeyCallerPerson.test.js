'use strict';

/**
 * B-7: the $everything response cache key must be private to the calling person regardless of
 * ENABLE_PATIENT_SCOPED_BINARY_CREATE, because the Binary read filter that makes responses
 * caller-specific is not gated on the flag (rollback safety, per-deployment flag drift).
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));

const { RedisManager } = require('../../../../utils/redisManager');
const { EverythingHelper } = require('../../../../operations/everything/everythingHelper');

const PATIENT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSON_A = '11111111-1111-4111-8111-111111111111';
const PERSON_B = '22222222-2222-4222-8222-222222222222';
const SCOPE = 'patient/*.read';

const argsFor = (id) => ({
    getOriginal: jest.fn().mockImplementation((k) => (k === 'id' ? { queryParameterValue: { value: id } } : undefined)),
    getRawArgs: jest.fn().mockReturnValue({})
});

const requestFor = (personId) => ({
    personIdFromJwtToken: personId,
    userType: undefined,
    accept: 'application/fhir+json',
    scope: SCOPE
});

describe('EverythingHelper.getCacheKey - caller person in key (B-7)', () => {
    let helper;
    let config;

    beforeEach(() => {
        config = { enablePatientScopedBinaryCreate: true };
        helper = Object.create(EverythingHelper.prototype);
        helper.configManager = config;
        helper.redisManager = new RedisManager({
            redisClient: {
                connectAsync: jest.fn().mockResolvedValue(undefined),
                get: jest.fn().mockResolvedValue('3'),
                incr: jest.fn().mockResolvedValue(1)
            }
        });
        helper.fetchPatientUUID = jest.fn().mockResolvedValue([PATIENT_UUID]);
    });

    const key = (id, personId) => helper.getCacheKey(argsFor(id), requestFor(personId), 'Patient', '4_0_0', false);

    test('flag on: two persons on the same Patient and scope get different keys', async () => {
        const keyA = await key('shared-patient', PERSON_A);
        const keyB = await key('shared-patient', PERSON_B);
        expect(keyA).toBeDefined();
        expect(keyB).toBeDefined();
        expect(keyA).not.toEqual(keyB);
        expect(keyA.endsWith(`:CallerPerson:${PERSON_A}`)).toBe(true);
    });

    test('flag on: the id prefix and generation are unchanged so prefix invalidation and generation bumps still apply', async () => {
        const keyA = await key('shared-patient', PERSON_A);
        expect(keyA.startsWith(`Patient:${PATIENT_UUID}:Everything:Generation:3:Scopes:`)).toBe(true);
    });

    test('flag off: still per-person (the Binary read filter is not flag-gated)', async () => {
        config.enablePatientScopedBinaryCreate = false;
        const keyA = await key('shared-patient', PERSON_A);
        const keyB = await key('shared-patient', PERSON_B);
        expect(keyA).not.toEqual(keyB);
        expect(keyA.endsWith(`:CallerPerson:${PERSON_A}`)).toBe(true);
    });

    test('flag on: the proxy-patient path (already per-person) is unchanged', async () => {
        const keyA = await key(`person.${PERSON_A}`, PERSON_A);
        expect(keyA.startsWith(`ClientPerson:${PERSON_A}:Everything:`)).toBe(true);
        expect(keyA).not.toContain('CallerPerson');
    });
});
