const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Unknown routes and unsupported versions', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test.each([['/'], ['/4_0_0/NotAResource']])('GET %s returns a 404 OperationOutcome', async (path) => {
        const request = await createTestRequest();

        const resp = await request.get(path).set(getHeaders());

        expect(resp.status).toStrictEqual(404);
        expect(resp.body.resourceType).toStrictEqual('OperationOutcome');
        expect(resp.body.issue[0].code).toStrictEqual('not-found');
    });

    test('unauthenticated GET / returns a 404 OperationOutcome', async () => {
        const request = await createTestRequest();

        const resp = await request.get('/');

        expect(resp.status).toStrictEqual(404);
        expect(resp.body.resourceType).toStrictEqual('OperationOutcome');
    });

    test.each([['/4_0_1/Patient'], ['/3_0_1/metadata']])('unauthenticated GET %s is not found', async (path) => {
        const request = await createTestRequest();

        const resp = await request.get(path);

        expect(resp.status).toStrictEqual(404);
    });

    test.each([
        ['/4_0_1/metadata'],
        ['/3_0_1/metadata'],
        ['/1_0_2/metadata'],
        ['/2_0_0/metadata'],
        ['/4_0_1/Patient'],
        ['/3_0_1/Patient/123'],
        ['/1_0_2/Observation'],
        ['/2_0_0/Patient']
    ])(
        'GET %s is not found instead of failing',
        async (path) => {
            const request = await createTestRequest();

            const resp = await request.get(path).set(getHeaders());

            expect(resp.status).toStrictEqual(404);
        }
    );

    test('GET /4_0_0/metadata returns the capability statement', async () => {
        const request = await createTestRequest();

        const resp = await request.get('/4_0_0/metadata').set(getHeaders());

        expect(resp.status).toStrictEqual(200);
        expect(resp.body.resourceType).toStrictEqual('CapabilityStatement');
        expect(resp.body.fhirVersion).toStrictEqual('4.0.0');
        const patient = resp.body.rest[0].resource.find((r) => r.type === 'Patient');
        expect(patient.interaction.map((i) => i.code)).toContain('read');
        expect(patient.searchParam.length).toBeGreaterThan(0);
        expect(patient.searchParam[0].versions).toBeUndefined();
    });
});
