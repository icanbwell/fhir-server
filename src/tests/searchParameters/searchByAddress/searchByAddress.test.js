// test file
const person1Resource = require('./fixtures/Person/person.json');

// expected
const expectedPersonResources1 = require('./fixtures/expected/expectedSearchByAddressLine.json');
const expectedPersonResources2 = require('./fixtures/expected/expectedSearchByAddressCity.json');
const expectedPersonResources3 = require('./fixtures/expected/expectedSearchByAddressPostalCode.json');
const expectedPersonResources4 = require('./fixtures/expected/expectedSearchByWrongAddress.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const { describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search_by_address Tests', () => {
        test('search_by_address when address line are same', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }]);

            // search by address, were address line has been passed as address query parameter
            resp = await request
                .get('/4_0_0/Person/?address=1%20Main%20St.&_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources1);
        });

        test('search_by_address based on country', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }]);

            // search by address, were country name has been passed as address query parameter
            resp = await request.get('/4_0_0/Person/?address=Berea&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources2);
        });

        test('search_by_address using postalcode', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }]);

            // search by address, were [postal code] has been passed as address query parameter
            resp = await request.get('/4_0_0/Person/?address=50001&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources3);
        });

        test('search_by_address provided wrong details', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }, { created: true }]);

            // search by address, with incorrect address has been passed make sure no data is being returned.
            resp = await request.get('/4_0_0/Person/?address=Venice&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources4);
        });
    });
});
