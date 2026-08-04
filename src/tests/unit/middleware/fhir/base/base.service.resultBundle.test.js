const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../../winstonInit', () => ({
    getLogger: () => ({ info: jestGlobal.fn(), error: jestGlobal.fn() })
}));

const chainable = () => ({
    send: () => ({ set: () => Promise.resolve({ status: 200 }) })
});

const mockSuperagent = {
    get: jestGlobal.fn(chainable),
    post: jestGlobal.fn(chainable)
};
jestGlobal.mock('superagent', () => mockSuperagent);

const svc = require('../../../../../middleware/fhir/base/base.service.js');

/**
 * Regression coverage for DCON-4803: makeResultBundle's dynamic requires (Bundle/BundleLink/
 * BundleEntry) previously pointed at paths that don't exist in this codebase, and the throw
 * that caused was silently swallowed by an unreferenced promise chain, leaving the batch/
 * transaction handler's returned promise pending forever instead of resolving or rejecting.
 */
describe('base.service batch - result bundle assembly (DCON-4803)', () => {
    beforeEach(() => {
        Object.values(mockSuperagent).forEach((fn) => fn.mockClear());
    });

    const makeReq = () => ({
        headers: { host: 'localhost:3000' },
        protocol: 'http',
        hostname: 'localhost',
        baseUrl: '',
        params: { base_version: '4_0_0' },
        body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{ request: { method: 'GET', url: 'Patient/123' }, resource: null }]
        }
    });

    const makeRes = () => ({
        req: { protocol: 'http', baseUrl: '', get: () => 'localhost:3000' }
    });

    test('a successful batch request resolves with a real Bundle response instead of hanging or throwing MODULE_NOT_FOUND', async () => {
        const resultBundle = await svc.batch(makeReq(), makeRes());

        expect(resultBundle.resourceType).toBe('Bundle');
        expect(resultBundle.type).toBe('batch');
        expect(resultBundle.entry).toHaveLength(1);
        expect(resultBundle.link[0].url).toBe('http://localhost:3000');
    });

    test('an error during result assembly rejects the returned promise instead of leaving it pending forever', async () => {
        // res.req.get('host') throwing simulates any error inside the Promise.all(...).then()
        // callback - previously this became an unhandled rejection on an orphaned promise chain,
        // and svc.batch()'s returned promise never settled.
        const brokenRes = {
            req: {
                protocol: 'http',
                baseUrl: '',
                get: () => {
                    throw new Error('boom');
                }
            }
        };

        await expect(svc.batch(makeReq(), brokenRes)).rejects.toThrow('boom');
    });
});
