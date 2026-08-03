const patient1Resource = require('./fixtures/Patient/patient1.json');
const patientClientBResource = require('./fixtures/Patient/patient_clientB.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

// A PUT by uuid must not let a caller with no access to a resource's tenant
// tell "this uuid belongs to someone else" apart from "this uuid doesn't
// exist anywhere".
describe('PUT by uuid must not leak cross-tenant existence', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('PUT by uuid for a uuid that does not exist anywhere still succeeds as a create', async () => {
        const request = await createTestRequest();
        const unusedUuid = '11111111-2222-3333-4444-555555555555';

        const resp = await request
            .put(`/4_0_0/Patient/${unusedUuid}`)
            .send({ ...patientClientBResource, id: unusedUuid })
            .set(getHeaders('access/clientB.* user/*.*'))
            .expect(201);

        expect(resp.body.id).toBe(unusedUuid);
    });

    test('PUT by uuid belonging to another tenant does not confirm the resource exists', async () => {
        const request = await createTestRequest();

        // clientA creates a resource. Capture its server-assigned uuid.
        const createResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patient1Resource)
            .set(getHeaders())
            .expect(200);
        expect(createResp).toHaveMergeResponse({ created: true });
        const clientAUuid = createResp._body.uuid;
        expect(clientAUuid).toBeDefined();

        // clientB has zero owner/access overlap with clientA and sends a PUT
        // for the exact uuid clientA's resource was assigned.
        const crossTenantUpdateResp = await request
            .put(`/4_0_0/Patient/${clientAUuid}`)
            .send({ ...patientClientBResource, id: clientAUuid })
            .set(getHeaders('access/clientB.* user/*.*'));

        // The response must not be the tenant-confirming forbidden error that
        // names the resource (e.g. "... has no write access to resource
        // Patient with id 1").
        const bodyText = JSON.stringify(crossTenantUpdateResp.body);
        expect(bodyText).not.toMatch(/no write access to resource/);

        // clientB must not have been able to overwrite clientA's resource.
        const verifyResp = await request
            .get(`/4_0_0/Patient/${clientAUuid}`)
            .set(getHeaders('access/clientA.* user/*.*'))
            .expect(200);
        expect(verifyResp.body.name[0].family).toBe('Smith');
    });
});
