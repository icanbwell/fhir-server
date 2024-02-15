// test file
const patientResource = require('./fixtures/patient/patient.json');

// expected
const expectedWithUuidOnly = require('./fixtures/expected/expected_with_uuid_only.json');
const expectedWithSourceIdAndUuid = require('./fixtures/expected/expected_with_uuid_and_sourceIds.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext,
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect} = require('@jest/globals');
const { ConfigManager } = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableGlobalIdSupport() {
        return true;
    }

    get enableReturnBundle() {
        return true;
    }
}

const headers = getHeaders();
describe('Patient Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('SearchById Tests)', () => {
        test('should generate optimize $in query when multiple uuids are passed', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Patient/1/$merge?validate=true')
                .send(patientResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync({ requestId: requestId });

            // ACT AND ASSERT
            resp = await request
                .get('/4_0_0/Patient/?id=6e03683f-003e-4367-9ef9-f9b16313451b,6e03683f-003e-4367-9ef9-f9b163134512&_debug=1')
                .set(headers);

            expect(resp).toHaveResponse(expectedWithUuidOnly);
        });

        test('should generate optimize $in query when multiple uuids, sourceIds are passed', async () => {
          const request = await createTestRequest((c) => {
              c.register('configManager', () => new MockConfigManager());
              return c;
          });

          const container = getTestContainer();
          // ARRANGE
          // add the resources to FHIR server
          let resp = await request
              .post('/4_0_0/Patient/1/$merge?validate=true')
              .send(patientResource)
              .set(getHeaders());
          // noinspection JSUnresolvedFunction
          expect(resp).toHaveMergeResponse({ created: true });

          /**
           * @type {PostRequestProcessor}
           */
          const postRequestProcessor = container.postRequestProcessor;
          await postRequestProcessor.waitTillDoneAsync({ requestId: requestId });

          // ACT AND ASSERT
          resp = await request
              .get('/4_0_0/Patient/?id=6e03683f-003e-4367-9ef9-f9b16313451b,6e03683f-003e-4367-9ef9-f9b163134512,patient-1,patient-2,patient-3,patient-4|client,patient-5|client-3&_debug=1')
              .set(headers);

          expect(resp).toHaveResponse(expectedWithSourceIdAndUuid);
      });
    });
});
