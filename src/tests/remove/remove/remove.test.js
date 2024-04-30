const patient1Resource = require('./fixtures/patient/patient1.json');
const patient2Resource = require('./fixtures/patient/patient2.json');
const patient3Resource = require('./fixtures/patient/patient3.json');

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

            // noinspection JSUnresolvedFunction
            expect(resp.body.length).toEqual(3);

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
    });
});
