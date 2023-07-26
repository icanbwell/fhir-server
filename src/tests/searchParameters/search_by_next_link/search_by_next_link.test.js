const { isUuid } = require('../../../utils/uid.util');
var env = require('var');

// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

// expected
const expectedPerson1Resource = require('./fixtures/expected/expected_person1.json');
const expectedPerson2Resource = require('./fixtures/expected/expected_person2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('Next link Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search Tests', () => {
        test('next link is present and works', async () => {
            // change DEFAULT_SORT_ID to _uuid
            const defaultSortId = env.DEFAULT_SORT_ID;
            env.DEFAULT_SORT_ID = '_uuid';

            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/2/$merge')
                .send(person2Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // response should have person2 as the only resource and nextLink should be present
            resp = await request
                .get('/4_0_0/Person?_count=1&_bundle=1')
                .set(getHeaders());

            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);
            const person2 = resp.body.entry[0].resource;
            delete person2.meta.lastUpdated;
            expect(person2).toEqual(expectedPerson2Resource);

            expect(resp.body.link).toBeDefined();
            expect(resp.body.link.length).toEqual(2);

            let nextLink = resp.body.link[1].url.replace('http://localhost:3000', '');
            expect(isUuid(nextLink.split('=').pop())).toBeTrue();

            // response should have person1 as the only resource and nextLink should be present
            resp = await request
                .get(nextLink)
                .set(getHeaders());

            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(1);
            const person1 = resp.body.entry[0].resource;
            delete person1.meta.lastUpdated;
            expect(person1).toEqual(expectedPerson1Resource);

            expect(resp.body.link).toBeDefined();
            expect(resp.body.link.length).toEqual(2);
            nextLink = resp.body.link[1].url.replace('http://localhost:3000', '');
            expect(isUuid(nextLink.split('=').pop())).toBeTrue();

            // response should not have any resource and nextLink should not be present
            resp = await request
                .get(nextLink)
                .set(getHeaders());

            expect(resp.body.entry).toBeDefined();
            expect(resp.body.entry.length).toEqual(0);

            expect(resp.body.link).toBeDefined();
            expect(resp.body.link.length).toEqual(1);

            // revert DEFAULT_SORT_ID to original value
            env.DEFAULT_SORT_ID = defaultSortId;
        });
    });
});