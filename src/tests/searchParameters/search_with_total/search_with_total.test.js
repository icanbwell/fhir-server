// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_person.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get useAccessIndex() {
        return true;
    }

    get resourcesWithAccessIndex() {
        return ['Person'];
    }
}

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search_with_total Tests', () => {
        test('search_with_total works', async () => {
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1&gender:missing=true&_debug=1&_total=accurate&_elements=id&_security=https://www.icanbwell.com/access%7Cbwell')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
    });
});
