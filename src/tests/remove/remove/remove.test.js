const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const patient3Resource = require('./fixtures/patient/patient3.json');

const auditEvent1Resource = require('./fixtures/AuditEvent/auditEvent1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient Tests for Remove operation', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Remove Tests', () => {
        test('Remove with id provided', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Deleted successfully
            await request
                .delete('/4_0_0/Patient/1')
                .set(getHeaders())
                .expect(204);

            // Deleted resource not found
            await request
                .get('/4_0_0/Patient/1')
                .set(getHeaders())
                .expect(404);
        });

        test('Remove with filter provided', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send([patient1Resource, patient2Resource, patient3Resource])
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // 3 resources created
            resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(200);

            // Here 2 are found as 1 of them is hidden.
            // noinspection JSUnresolvedFunction
            expect(resp.body.length).toEqual(2);

            // Matched resources are deleted
            resp = await request
                .delete('/4_0_0/Patient?gender=male')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ deleted: 2 });

            // On getting resources, only 1 must be found
            resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp.body.length).toEqual(1);
        });

        test('Remove without any filter provided', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Patient/$merge')
                .send(patient1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Nothing is deleted
            resp = await request
                .delete('/4_0_0/Patient')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ deleted: 0 });
        });

        test('System AuditEvent is not generated for deleting AuditEvent', async () => {
            const envValue = process.env.REQUIRED_AUDIT_EVENT_FILTERS;
            process.env.REQUIRED_AUDIT_EVENT_FILTERS = '';
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/AuditEvent/$merge')
                .send(auditEvent1Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/AuditEvent/')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResourceCount(1);

            // Nothing is deleted
            resp = await request
                .delete('/4_0_0/AuditEvent/113aeb5b-e939-43d3-816d-b902168d9d22')
                .set(getHeaders())
                .expect(204);

            resp = await request
                .get('/4_0_0/AuditEvent/')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResourceCount(0);
            process.env.REQUIRED_AUDIT_EVENT_FILTERS = envValue;
        });
    });
});
