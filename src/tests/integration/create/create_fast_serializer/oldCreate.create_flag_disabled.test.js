process.env.ENABLE_CREATE_FAST_SERIALIZER = '0';

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Create with fast serializer disabled', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('create uses the existing flow when the flag is disabled', async () => {
        await createTestRequest();
        expect(getTestContainer().createOperation.useFastSerializer).toStrictEqual(false);
    });

    test('existing flow ignores a client supplied meta.lastUpdated that is not a valid instant', async () => {
        const request = await createTestRequest();
        const payload = {
            resourceType: 'Observation',
            status: 'final',
            code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
            meta: {
                source: 'client',
                lastUpdated: '2021-06-01',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'client' },
                    { system: 'https://www.icanbwell.com/owner', code: 'client' }
                ]
            }
        };
        const resp = await request.post('/4_0_0/Observation').send(payload).set(getHeaders());
        expect(resp).toHaveStatusCode(201);
    });

    test('existing flow accepts an empty object for a required field', async () => {
        const request = await createTestRequest();
        const payload = {
            resourceType: 'Observation',
            status: 'final',
            code: {},
            meta: {
                source: 'client',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'client' },
                    { system: 'https://www.icanbwell.com/owner', code: 'client' }
                ]
            }
        };
        const resp = await request.post('/4_0_0/Observation').send(payload).set(getHeaders());
        expect(resp).toHaveStatusCode(201);
    });
});
