// test file
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');

// expected
const expectedAuditEventResources = require('./fixtures/expected/expected_AuditEvent.json');
const expectedMergeResponse = require('./fixtures/expected/expectedMergeResponse.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('AuditEvent Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent mergeWithMissingId Tests', () => {
        test('mergeWithMissingId works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMergeResponse);

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResources);
        });
    });
});
