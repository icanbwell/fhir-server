// provider file
const task1Resource = require('./fixtures/task/task1.json');
const task2Resource = require('./fixtures/task/task2.json');
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');
const observation3Resource = require('./fixtures/observation/observation3.json');

// expected
const expectedTaskResource = require('./fixtures/expected/expectedTask.json');
const expectedObservationResource = require('./fixtures/expected/expectedObservation.json');
const expectedObservation2Resource = require('./fixtures/expected/expectedObservation2.json');
const expectedOperationOutcome = require('./fixtures/expected/expectedOperationOutcome.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersJsonPatch
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient reference tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient reference update', () => {
        test('Reference update using merge for Task', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Task/$merge')
                .send(task1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Task/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedTaskResource);

            resp = await request
                .post('/4_0_0/Task/$merge')
                .send(task2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({
                created: false,
                updated: false,
                issue: expectedOperationOutcome.issue[0]
            });

            resp = await request
                .get('/4_0_0/Task/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedTaskResource);
        });

        test('Reference update using merge for Observation', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedObservationResource);

            resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({
                created: false,
                updated: false,
                issue: expectedOperationOutcome.issue[0]
            });

            resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation3Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({
                created: false,
                updated: true
            });

            resp = await request
                .get('/4_0_0/Observation/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedObservation2Resource);
        });

        test('Reference update using update for Task', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Task/$merge')
                .send(task1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Task/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedTaskResource);

            resp = await request
                .put('/4_0_0/Task/1')
                .send(task2Resource)
                .set(getHeaders())
                .expect(400);

            expect(resp).toHaveResponse(expectedOperationOutcome);
        });

        test('Reference update using put for Observation', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedObservationResource);

            resp = await request
                .put('/4_0_0/Observation/1')
                .send(observation2Resource)
                .set(getHeaders())
                .expect(400);

            expect(resp).toHaveResponse(expectedOperationOutcome);
        });

        test('Reference update using patch for Task', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Task/$merge')
                .send(task1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Task/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedTaskResource);

            resp = await request
                .patch('/4_0_0/Task/1')
                .send([
                    {
                        op: 'replace',
                        path: '/for/reference',
                        value: 'Patient/2'
                    }
                ])
                .set(getHeadersJsonPatch())
                .expect(400);

            expect(resp).toHaveResponse(expectedOperationOutcome);
        });

        test('Reference update using patch for Observation', async () => {
            const request = await createTestRequest();

            let resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get('/4_0_0/Observation/1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedObservationResource);

            resp = await request
                .patch('/4_0_0/Observation/1')
                .send([
                    {
                        op: 'replace',
                        path: '/subject/reference',
                        value: 'Patient/2'
                    }
                ])
                .set(getHeadersJsonPatch())
                .expect(400);

            expect(resp).toHaveResponse(expectedOperationOutcome);
        });
    });
});
