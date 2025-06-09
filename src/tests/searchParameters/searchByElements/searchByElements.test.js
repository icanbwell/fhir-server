// test file
const personResource = require('./fixtures/Person/person.json');

// expected
const expectedPersonWithOnlyId = require('./fixtures/expected/expectedPersonId.json');
const expectedPersonWithOnlyMetaField = require('./fixtures/expected/expectedPersonMeta.json');
const expectedPersonWithIdAndMetaFields = require('./fixtures/expected/expectedPersonIdAndMeta.json');
const expectedPersonResourcesIdWhenUsingAccessIndex = require('./fixtures/expected/expectedPersonIdWhenUsingAccessIndex.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search by passing _elements Tests', () => {
        test('Person search by passing id, meta in _elements', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            // Passing _elements=id, and should receive only id in respone
            resp = await request
                .get('/4_0_0/Person/?_elements=id&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithOnlyId);

            // Passing _elements=meta, and should receive only meta in respone
            resp = await request
                .get('/4_0_0/Person/?_elements=id,meta&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithOnlyMetaField);

            // Passing _elements=id,meta, and should receive both the fields in response
            resp = await request
                .get('/4_0_0/Person/?_elements=meta,id&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithIdAndMetaFields);

            // Passing non root level field in _elements, error with 400 status code is expected.
            resp = await request
                .get('/4_0_0/Person?_elements=meta,id,address.state')
                .set(getHeaders());
            expect(resp).toHaveStatusCode(400);

            // Passing invalid field in _elements, error with 400 status code is expected.
            resp = await request
                .get('/4_0_0/Person?_elements=meta,id,xyz')
                .set(getHeaders());
            expect(resp).toHaveStatusCode(400);
        });

        test('Person search by setting useAccessIndex to true', async () => {
            process.env.USE_ACCESS_INDEX = 1;
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            // Passing _elements=id, and should receive only id in respone
            resp = await request
                .get('/4_0_0/Person/?_elements=id&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResourcesIdWhenUsingAccessIndex);

            // Passing _elements=meta, and should receive only meta in respone
            resp = await request
                .get('/4_0_0/Person/?_elements=id,meta&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithOnlyMetaField);

            // Passing _elements=id,meta, and should receive both the fields in response
            resp = await request
                .get('/4_0_0/Person/?_elements=meta,id&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithIdAndMetaFields);
            process.env.USE_ACCESS_INDEX = 0;
        });

        test('Person search by letting person be the collection that uses access index', async () => {
            const currentCollectionAccessIndex = process.env.COLLECTIONS_ACCESS_INDEX;
            process.env.COLLECTIONS_ACCESS_INDEX = ['Person'];
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

            // Passing _elements=id, and should receive only id in respone
            resp = await request
                .get('/4_0_0/Person/?_elements=id&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithOnlyId);

            // Passing _elements=meta, and should receive only meta in respone
            resp = await request
                .get('/4_0_0/Person/?_elements=id,meta&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithOnlyMetaField);

            // Passing _elements=id,meta, and should receive both the fields in response
            resp = await request
                .get('/4_0_0/Person/?_elements=meta,id&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithIdAndMetaFields);
            process.env.USE_ACCESS_INDEX = currentCollectionAccessIndex;
        });
    });
});
