// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');

// expected
const expectedSinglePatientResource = require('./fixtures/expected/expected_single_patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getHeadersFormUrlEncoded
} = require('../../common');
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManagerDefaultSortId extends ConfigManager {
    get defaultSortId() {
        return '_uuid';
    }

    get streamResponse() {
        return true;
    }

    get enableReturnBundle() {
        return true;
    }
}

describe('PatientReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Search By Id Tests', () => {
        test('search by single id works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerDefaultSortId());
                return c;
            });
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());
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

            resp = await request.get('/4_0_0/Patient/00100000000').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource.entry[0].resource);

            resp = await request.post('/4_0_0/Patient/_search?id=00100000000').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);

            resp = await request
                .post('/4_0_0/Patient/_search')
                .send("id=00100000000")
                .set(getHeadersFormUrlEncoded());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);

            resp = await request
                .post('/4_0_0/Patient/')
                .send("id=00100000000")
                .set(getHeadersFormUrlEncoded());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);

            resp = await request.get('/4_0_0/Patient/_search').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(404);
        });
        test('search by single id works by POST', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerDefaultSortId());
                return c;
            });
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Patient/_search')
                .send("id=00100000000")
                .set(getHeadersFormUrlEncoded());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedSinglePatientResource);

            // resp = await request
            //     .post('/4_0_0/Patient/')
            //     .send("id=00100000000")
            //     .set(getHeadersFormUrlEncoded());
            // // noinspection JSUnresolvedFunction
            // expect(resp).toHaveResponse(expectedSinglePatientResource);
        });
    });
});
