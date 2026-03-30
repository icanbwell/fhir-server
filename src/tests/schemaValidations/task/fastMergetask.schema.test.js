// test file
const taskResources = require('./fixtures/task/task-fastMerge.json');

// expected
const expectedResponse = require('./fixtures/expected/expectedResponse-fastMerge.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect, beforeAll, afterAll } = require('@jest/globals');

describe('Task Validation Tests', () => {
    beforeAll(() => {
        process.env.ENABLE_MERGE_FAST_SERIALIZER = '1';
    });

    afterAll(() => {
        delete process.env.ENABLE_MERGE_FAST_SERIALIZER;
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Task Tests', () => {
        test('Task validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/Task/$merge')
                .send(taskResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
