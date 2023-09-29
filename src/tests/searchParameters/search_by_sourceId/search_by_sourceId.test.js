// test file
const patient1Resource = require('./fixtures/Patient/patient1.json');
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPerson = require('./fixtures/expected/expected_person.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }

    get enableReturnBundle() {
        return true;
    }
}

describe('Observation Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search_by_patient_with_source_id Tests', () => {
        test('search_by_patient_with_source_id returns person', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({requestId: requestId});

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
            await postRequestProcessor.waitTillDoneAsync({requestId: requestId});

            resp = await request
                .get('/4_0_0/Person/?_debug=1&patient=Patient/efrGiFXEMyusEsK8nw9.g3bbt9oqmQ-HeGPcnrfUYS0s3|bwell_demo')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPerson);
        });
    });
});
