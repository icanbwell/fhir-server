// test file
const procedure1Resource = require('./fixtures/Procedure/procedure1.json');

// expected
const expectedProcedureResources = require('./fixtures/expected/expected_procedure.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Procedure Validate Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Procedure procedure Tests', () => {
        test('procedure works', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Procedure')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Procedure/$validate')
                .send(procedure1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedProcedureResources);
        });
    });
});
