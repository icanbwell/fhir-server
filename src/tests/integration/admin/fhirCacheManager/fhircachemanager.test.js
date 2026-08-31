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

    describe('Test Cache Management', () => {
        test('fetch cache keys by resource', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            const streams = container.redisClient.streams;
            streams.set('Patient:12345:summary', []);
            streams.set('Patient:12345:medications', []);
            streams.set('ClientPerson:67890:summary', []);
            let resp = await request
                .get(`/admin/getCacheKeys?resourceType=Patient&resourceId=12345`)
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'))
                .expect(200);

            expect(resp.body.cacheKeys).toBeDefined();
            expect(resp.body.cacheKeys).toContain('Patient:12345:summary');
            expect(resp.body.cacheKeys).toContain('Patient:12345:medications');

            resp =  await request
                .get(`/admin/getCacheKeys?resourceType=Person&resourceId=67890`)
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'))
                .expect(200);

            expect(resp.body.cacheKeys).toContain('ClientPerson:67890:summary');
            streams.clear();
        });

        test('invalidate caches', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();
            const streams = container.redisClient.streams;
            streams.set('Patient:12345:summary', []);
            streams.set('Patient:12345:medications', []);
            streams.set('ClientPerson:67890:summary', []);

            await request
                .post(`/admin/invalidateCache`)
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'))
                .send({cacheKeys: ['Patient:12345:summary', 'ClientPerson:67890:summary']})
                .expect(200);

            expect(streams.has('Patient:12345:summary')).toBe(false);
            expect(streams.has('ClientPerson:67890:summary')).toBe(false);
            expect(streams.has('Patient:12345:medications')).toBe(true);

            await request
                .post(`/admin/invalidateCache`)
                .set(getHeadersWithCustomToken('user/*.read admin/*.*'))
                .send({resourceType: 'Patient', resourceId: '12345'})
                .expect(200);

            expect(streams.has('Patient:12345:medications')).toBe(false);
            streams.clear();
        });
    });
});
