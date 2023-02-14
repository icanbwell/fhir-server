// test file
const person1Resource = require('./fixtures/Person/person.json');

// expected
const expectedPersonExact = require('./fixtures/expected/expected_Person_exact.json');
const expectedPersonCaseSensitive1 = require('./fixtures/expected/expected_Person_case_sensitive1.json');
const expectedPersonCaseSensitive2 = require('./fixtures/expected/expected_Person_case_sensitive2.json');
const expectedPersonSameName = require('./fixtures/expected/expected_Person_same_name.json');

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

    const emptyPersonResponse = {
        entry: [],
        resourceType: 'Bundle',
        total: 0,
        type: 'searchset',
    };

    describe('Person search_by_given Tests', () => {
        test('search_by_given returns exact result', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true },
                { created: true },
                { created: true },
                { created: true },
            ]);

            // ACT & ASSERT
            // search by given name returns exact person
            resp = await request.get('/4_0_0/Person?given=John&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonExact);
        });

        test('search_by_given is case sensitive', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true },
                { created: true },
                { created: true },
                { created: true },
            ]);

            // ACT & ASSERT
            // search by given name is case sensitive
            resp = await request.get('/4_0_0/Person?given=john&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(emptyPersonResponse);

            // search by given name is case sensitive
            resp = await request.get('/4_0_0/Person?given=Test&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonCaseSensitive1);

            // search by given name is case sensitive
            resp = await request.get('/4_0_0/Person?given=test&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonCaseSensitive2);
        });

        test('search_by_given returns multiple Person with same name', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([
                { created: true },
                { created: true },
                { created: true },
                { created: true },
                { created: true },
            ]);

            // ACT & ASSERT
            // search by given name is case sensitive
            resp = await request.get('/4_0_0/Person?given=Test1&_bundle=1').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonSameName);
        });
    });
});
