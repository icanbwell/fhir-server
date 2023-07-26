// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');
const person4Resource = require('./fixtures/Person/person4.json');
const person5Resource = require('./fixtures/Person/person5.json');
const person6Resource = require('./fixtures/Person/person6.json');
const person7Resource = require('./fixtures/Person/person7.json');
const person8Resource = require('./fixtures/Person/person8.json');
const person9Resource = require('./fixtures/Person/person9.json');
const person10Resource = require('./fixtures/Person/person10.json');
const person11Resource = require('./fixtures/Person/person11.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');
const expectedPersonWithLenientSearchResource = require('./fixtures/expected/expected_person_lenient_search.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search_by_name Tests', () => {
        test('search_by_name works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/2/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/3/$merge?validate=true')
                .send(person3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/4/$merge?validate=true')
                .send(person4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/5/$merge?validate=true')
                .send(person5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/6/$merge?validate=true')
                .send(person6Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/7/$merge?validate=true')
                .send(person7Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/8/$merge?validate=true')
                .send(person8Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/9/$merge?validate=true')
                .send(person9Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/10/$merge?validate=true')
                .send(person10Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/11/$merge?validate=true')
                .send(person11Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Medication back
            resp = await request
                .get('/4_0_0/Person?name=singhal&_bundle=1&')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });

        test('search_by_name with handling type as lenient', async () => {
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/2/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/3/$merge?validate=true')
                .send(person3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/4/$merge?validate=true')
                .send(person4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Search with invalid query parameters and handling type is lenient
            // Should return all the person resources
            let lenientHeader = getHeaders();
            lenientHeader['handling'] = 'lenient';
            resp = await request
                .get('/4_0_0/Person?fname=singhal&_bundle=1')
                .set(lenientHeader);
            expect(resp.status).toBe(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonWithLenientSearchResource);
        });

        test('search_by_name but handling type as strict', async () => {
            const request = await createTestRequest();
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/2/$merge?validate=true')
                .send(person2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // Search with invalid query parameters and handlig type as strict
            // Should return an error as fname is not a valid query param for Person
            let strictHeader = getHeaders();
            strictHeader['handling'] = 'strict';
            resp = await request
                .get('/4_0_0/Person?fname=singhal&_bundle=1')
                .set(strictHeader);
            expect(resp.status).toBe(400);
            expect(resp.text.includes('fname is not a parameter for Person')).toBe(true);
        });
    });
});
