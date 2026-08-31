// test file
const auditEventResources = require('./fixtures/auditEvent/auditEvent.json');

// expected
const expectedResponse = require('./fixtures/expected/expectedResponse.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('AuditEvent Validation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent Tests', () => {
        test('AuditEvent validations', async () => {
            const request = await createTestRequest();

            const resp = await request
                .post('/4_0_0/AuditEvent/$merge')
                .send(auditEventResources)
                .set(getHeaders())
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResponse);
        });
    });
});
