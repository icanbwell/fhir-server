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
            let resp = await request
                .get('/buglist.cgi')
                .set(getHtmlHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
        test('url missing 4_0_0 fails', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .get('/DocumentReference?patient=2c1f3c13-2baa-4079-a5c1-e5d8f7cb61b0')
                .set(getHtmlHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
    });
});
