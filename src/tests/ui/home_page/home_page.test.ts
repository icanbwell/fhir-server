const {commonBeforeEach, commonAfterEach, createTestRequest, getHtmlHeaders} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient home_page Tests', () => {
        test('home_page works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .get('/')
                .set(getHtmlHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
            expect(resp.text).toStartWith('<!DOCTYPE html>');
        });
    });
});
