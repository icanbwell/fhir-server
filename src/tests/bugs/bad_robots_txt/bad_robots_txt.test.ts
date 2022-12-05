const {commonBeforeEach, commonAfterEach, createTestRequest, getHtmlHeaders} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Bad url Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('bad url Tests', () => {
        // noinspection JSUnresolvedFunction
        test('bad url fails', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            const headers = getHtmlHeaders();
            headers['Accept'] = '*/*';
            let resp = await request
                .get('/robots.txt')
                .set(headers);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
    });
});
