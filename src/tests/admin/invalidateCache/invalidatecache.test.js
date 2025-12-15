const {
    commonBeforeEach,
    commonAfterEach,
    getHeadersWithCustomToken,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Patient Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Invalidate cache tests', () => {
        test('should invalidate cache by prefix', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            const streams = container.redisClient.streams;
            streams.set('Patient:12345:summary', []);
            streams.set('Patient:12345:medications', []);
            streams.set('Patient:67890:summary', []);
            await request
                .post(`/admin/invalidateCache`)
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'))
                .send({resourceType: 'Patient', resourceId: '12345'})
                .expect(200);

            expect(streams.has('Patient:12345:summary')).toBe(false);
            expect(streams.has('Patient:12345:medications')).toBe(false);
            expect(streams.has('Patient:67890:summary')).toBe(true);
        });
    });
});
