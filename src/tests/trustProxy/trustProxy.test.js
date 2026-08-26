const supertest = require('supertest');
const observationResource = require('./fixtures/observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestApp
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const FORWARDED_HEADERS = {
    'X-Forwarded-Host': 'attacker.example.com',
    'X-Forwarded-Proto': 'https',
    'X-Forwarded-For': '1.2.3.4, 5.6.7.8, 9.10.11.12'
};

describe('trust proxy Tests', () => {
    const originalHopCount = process.env.TRUST_PROXY_HOP_COUNT;

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        if (originalHopCount === undefined) {
            delete process.env.TRUST_PROXY_HOP_COUNT;
        } else {
            process.env.TRUST_PROXY_HOP_COUNT = originalHopCount;
        }
    });

    /**
     * @param {string|undefined} hopCount value for TRUST_PROXY_HOP_COUNT, or undefined to leave it unset
     * @return {import('supertest').SuperTest<import('supertest').Test>}
     */
    function createRequestWithHopCount(hopCount) {
        if (hopCount === undefined) {
            delete process.env.TRUST_PROXY_HOP_COUNT;
        } else {
            process.env.TRUST_PROXY_HOP_COUNT = hopCount;
        }
        return supertest(createTestApp());
    }

    /**
     * @param {import('supertest').SuperTest<import('supertest').Test>} request
     * @return {Promise<string>} the self link of a search bundle built from the forwarded headers
     */
    async function getSelfLinkForForwardedRequest(request) {
        await request
            .post('/4_0_0/Observation/$merge')
            .send(observationResource)
            .set(getHeaders())
            .expect(200);

        const response = await request
            .get('/4_0_0/Observation?_bundle=1')
            .set({ ...getHeaders(), ...FORWARDED_HEADERS })
            .expect(200);

        return response.body.link.find((link) => link.relation === 'self').url;
    }

    describe('bundle link urls honor X-Forwarded-Host/Proto only per the configured hop count', () => {
        test('a hop count of 0 ignores forwarded headers and uses the real Host header', async () => {
            const selfLink = await getSelfLinkForForwardedRequest(createRequestWithHopCount('0'));

            expect(selfLink).toBe('http://localhost:3000/4_0_0/Observation?_bundle=1');
            expect(selfLink).not.toContain('attacker.example.com');
        });

        test('a hop count of 1 trusts the forwarded headers of the connecting peer', async () => {
            const selfLink = await getSelfLinkForForwardedRequest(createRequestWithHopCount('1'));

            expect(selfLink).toBe('https://attacker.example.com/4_0_0/Observation?_bundle=1');
        });

        test('the default hop count trusts the forwarded headers of the connecting peer', async () => {
            const selfLink = await getSelfLinkForForwardedRequest(createRequestWithHopCount(undefined));

            expect(selfLink).toBe('https://attacker.example.com/4_0_0/Observation?_bundle=1');
        });

        test('a non-integer hop count falls back to the default instead of disabling proxy trust', async () => {
            const selfLink = await getSelfLinkForForwardedRequest(
                createRequestWithHopCount('not-an-integer')
            );

            expect(selfLink).toBe('https://attacker.example.com/4_0_0/Observation?_bundle=1');
        });

        test('a fractional hop count falls back to the default instead of disabling proxy trust', async () => {
            const selfLink = await getSelfLinkForForwardedRequest(createRequestWithHopCount('2.5'));

            expect(selfLink).toBe('https://attacker.example.com/4_0_0/Observation?_bundle=1');
        });

        test('an empty hop count falls back to the default instead of disabling proxy trust', async () => {
            const selfLink = await getSelfLinkForForwardedRequest(createRequestWithHopCount(''));

            expect(selfLink).toBe('https://attacker.example.com/4_0_0/Observation?_bundle=1');
        });

        test('every link in the bundle is built from the same host, not just the self link', async () => {
            const request = createRequestWithHopCount('0');
            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set(getHeaders())
                .expect(200);

            const response = await request
                .get('/4_0_0/Observation?_bundle=1')
                .set({ ...getHeaders(), ...FORWARDED_HEADERS })
                .expect(200);

            expect(response.body.link.length).toBeGreaterThan(0);
            for (const link of response.body.link) {
                expect(link.url).toMatch(/^http:\/\/localhost:3000\//);
            }
        });
    });

    describe('a multi-value X-Forwarded-Host resolves to the left-most host', () => {
        const MULTI_HOST_HEADERS = {
            'X-Forwarded-Host': 'first.example.com, second.example.com, third.example.com',
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-For': '1.1.1.1, 2.2.2.2, 3.3.3.3'
        };

        /**
         * @param {string|undefined} hopCount
         * @return {Promise<string>}
         */
        async function getSelfLinkForMultiHostRequest(hopCount) {
            const request = createRequestWithHopCount(hopCount);
            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set(getHeaders())
                .expect(200);

            const response = await request
                .get('/4_0_0/Observation?_bundle=1')
                .set({ ...getHeaders(), ...MULTI_HOST_HEADERS })
                .expect(200);

            return response.body.link.find((link) => link.relation === 'self').url;
        }

        test('a hop count of 1 uses the left-most host and ignores the rest', async () => {
            const selfLink = await getSelfLinkForMultiHostRequest('1');

            expect(selfLink).toBe('https://first.example.com/4_0_0/Observation?_bundle=1');
            expect(selfLink).not.toContain('second.example.com');
            expect(selfLink).not.toContain('third.example.com');
        });

        test('a hop count of 2 still uses the left-most host, so the count gates but does not select', async () => {
            const selfLink = await getSelfLinkForMultiHostRequest('2');

            expect(selfLink).toBe('https://first.example.com/4_0_0/Observation?_bundle=1');
        });

        test('the default hop count still uses the left-most host', async () => {
            const selfLink = await getSelfLinkForMultiHostRequest(undefined);

            expect(selfLink).toBe('https://first.example.com/4_0_0/Observation?_bundle=1');
        });

        test('a hop count of 0 ignores every forwarded host', async () => {
            const selfLink = await getSelfLinkForMultiHostRequest('0');

            expect(selfLink).toBe('http://localhost:3000/4_0_0/Observation?_bundle=1');
            expect(selfLink).not.toContain('example.com');
        });
    });

    describe('Content-Location honors X-Forwarded-Proto only per the configured hop count', () => {
        /**
         * @param {string|undefined} hopCount
         * @return {Promise<string>}
         */
        async function getContentLocationForForwardedCreate(hopCount) {
            const request = createRequestWithHopCount(hopCount);
            const response = await request
                .post('/4_0_0/Observation/')
                .send(observationResource)
                .set({ ...getHeaders(), ...FORWARDED_HEADERS })
                .expect(201);

            return response.headers['content-location'];
        }

        test('a hop count of 0 ignores X-Forwarded-Proto', async () => {
            const contentLocation = await getContentLocationForForwardedCreate('0');

            expect(contentLocation).toMatch(/^http:\/\//);
        });

        test('a hop count of 1 trusts X-Forwarded-Proto', async () => {
            const contentLocation = await getContentLocationForForwardedCreate('1');

            expect(contentLocation).toMatch(/^https:\/\//);
        });
    });
});
