// test file
const invalidResource = require('./fixtures/Invalid_Resource.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const { describe, beforeEach, afterEach, test, expect, beforeAll, afterAll, jest } = require('@jest/globals');
const { BaseSerializer } = require('../../../fhir/writeSerializers/4_0_0/customSerializers');

describe('Invalid Resource Tests (Fast Merge Serializer)', () => {
    beforeAll(() => {
        process.env.ENABLE_MERGE_FAST_SERIALIZER = '1';
    });

    afterAll(() => {
        delete process.env.ENABLE_MERGE_FAST_SERIALIZER;
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Invalid Resource Merge Tests', () => {
        test('Merge throws 400 status code', async () => {
            const writeSerializerSpy = jest.spyOn(BaseSerializer.prototype, 'writeSerialize');

            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            const resp = await request
                .post('/4_0_0/Person/$merge')
                .send(invalidResource)
                .set(getHeaders())
                .expect(200);
            expect(
                resp.body.operationOutcome.issue[0].details.text
            ).toStrictEqual(
                'Unable to create/update resource. Missing either metadata or metadata source.'
            );
            // validations are run before serialization
            expect(writeSerializerSpy).not.toHaveBeenCalled();
        });
    });
});
