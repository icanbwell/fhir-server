// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManagerWithTwoStepOptimizationBundle extends ConfigManager {
    get enableTwoStepOptimization() {
        return true;
    }
    get streamResponse() {
        return false;
    }
}

class MockConfigManagerWithTwoStepOptimizationStreaming extends ConfigManager {
    get enableTwoStepOptimization() {
        return true;
    }
    get streamResponse() {
        return true;
    }
}

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person test_resource_not_found Tests', () => {
        test('test_resource_not_found works with bundle', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithTwoStepOptimizationBundle());
                return c;
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
                .get('/4_0_0/Person/?_bundle=1&identifier=http://www.walgreens.com/profileid|2000017500333-02')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('test_resource_not_found works with streaming', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManagerWithTwoStepOptimizationStreaming());
                return c;
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
                .get('/4_0_0/Person/?_bundle=1&identifier=http://www.walgreens.com/profileid|2000017500333-02')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
    });
});
