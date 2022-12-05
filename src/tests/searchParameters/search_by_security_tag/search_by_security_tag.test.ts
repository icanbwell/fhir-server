// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');

// expected
const expectedPersonHealthSystem1Resources = require('./fixtures/expected/expected_Person_healthsystem1.json');
const expectedPersonHealthSystem2Resources = require('./fixtures/expected/expected_Person_healthsystem2.json');
const expectedPersonHealthSystem2NotQueryResources = require('./fixtures/expected/expected_Person_healthsystem2_not_query.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search_by_security_tag Tests', () => {
        test('search_by_security_tag works', async () => {
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

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Medication back
            resp = await request
                .get('/4_0_0/Person?_security=https://www.icanbwell.com/owner%7Chealthsystem1&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonHealthSystem1Resources);

            resp = await request
                .get('/4_0_0/Person?_security=https://www.icanbwell.com/owner%7Chealthsystem2&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonHealthSystem2Resources);

            resp = await request
                .get('/4_0_0/Person?_security:not=https://www.icanbwell.com/owner%7Chealthsystem1&_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonHealthSystem2NotQueryResources);
        });
    });
});
