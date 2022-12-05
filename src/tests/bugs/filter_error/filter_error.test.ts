const {commonBeforeEach, commonAfterEach, createTestRequest, getHtmlHeaders} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient filter_error Tests', () => {
        test('filter_error works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .get('/4_0_0/?query=query%20%7B%0A%20%20%20%20%20%20person(%0A%20%20%20%20%20%20%20%20identifier:%20%7B%0A%20%20%20%20%20%20%20%20%20%20value:%20%7B%20system:%20%22http://www.walgreens.com/profileid%22,%20value:%20%229333333%22%20%7D%0A%20%20%20%20%20%20%20%20%7D%0A%20%20%20%20%20%20)%20%7B%0A%20%20%20%20%20%20%20%20id%0A%20%20%20%20%20%20%20%20name%20%7B%0A%20%20%20%20%20%20%20%20%20%20family,%0A%20%20%20%20%20%20%20%20%20%20given%0A%20%20%20%20%20%20%20%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D')
                .set(getHtmlHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
    });
});
