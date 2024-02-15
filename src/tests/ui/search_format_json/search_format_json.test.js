// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const expectedPatient1Resource = require('./fixtures/expected/expected_patient1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHtmlHeaders,
    createTestRequest
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

describe('Patient UI Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests', () => {
        test('search by single name works', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            const htmlHeaders = getHtmlHeaders();
            resp = await request
                .get('/4_0_0/Patient/00100000000?_format=json')
                .set(htmlHeaders);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusOk();
            // noinspection JSUnresolvedReference
            expect(resp).toHaveResponse(expectedPatient1Resource);
        });
    });
});
