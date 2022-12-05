const {commonBeforeEach, commonAfterEach, createTestRequest, getHtmlHeaders} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Encounter Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Encounter searchEmptyEncounters Tests', () => {
        test('searchEmptyEncounters works', async () => {
            const request = await createTestRequest();
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Encounter back
            let resp = await request
                .get('/4_0_0/Encounter/?_security=https://www.icanbwell.com/access%7Cmps-api&_elements=id&_count=10&_getpagesoffset=1')
                .set(getHtmlHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
        });
        test('searchEmptyEncounters works with _debug', async () => {
            const request = await createTestRequest();
            // ACT & ASSERT
            // search by token system and code and make sure we get the right Encounter back
            let resp = await request
                .get('/4_0_0/Encounter/?_security=https://www.icanbwell.com/access%7Cmps-api&_elements=id&_count=10&_getpagesoffset=1&_debug=1')
                .set(getHtmlHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
        });
    });
});
