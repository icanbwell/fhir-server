// test file
const person1Resource = require('./fixture/person1.json');
const updatedPerson1Resource = require('./fixture/updated_person1.json');

// expected
const expectedPerson1Resources = require('./fixture/expected/expected_person1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Put identifier Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Update identifier updates all the identifier values except the sourceId and uuid', async () => {
        const request = await createTestRequest();
        // Create the resource
        let resp = await request
            .post('/4_0_0/Person/$merge')
            .send(person1Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        expect(resp).toHaveMergeResponse({ created: true });

        // Now update the resource
        resp =  await request
            .put('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .send(updatedPerson1Resource)
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction

        // Now read the resource and verify
        resp = await request
            .get('/4_0_0/Person/7d744c63-fa81-45e9-bcb4-f312940e9300')
            .set(getHeaders())
            .expect(200);
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedPerson1Resources);
    });
});
