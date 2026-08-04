const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../../winstonInit', () => ({
    getLogger: () => ({ info: jestGlobal.fn(), error: jestGlobal.fn() })
}));

// makeResultBundle's dynamic schema requires (base.service.js:16-20) don't resolve to any real
// file in this codebase - a genuine pre-existing bug, unrelated to and out of scope for the SSRF
// fix under test here. Virtual-mocking them keeps that separate bug from crashing this suite.
const FakeBundleClass = (fields) => Object.assign({}, fields);
jestGlobal.mock(
    '../../../../../middleware/fhir/resources/4_0_0/schemas/bundle',
    () =>
        function Bundle(fields) {
            return FakeBundleClass(fields);
        },
    { virtual: true }
);
jestGlobal.mock(
    '../../../../../middleware/fhir/resources/4_0_0/schemas/bundlelink',
    () =>
        function BundleLink(fields) {
            return FakeBundleClass(fields);
        },
    { virtual: true }
);
jestGlobal.mock(
    '../../../../../middleware/fhir/resources/4_0_0/schemas/bundleentry',
    () =>
        function BundleEntry(fields) {
            return FakeBundleClass(fields);
        },
    { virtual: true }
);

const chainable = () => ({
    send: () => ({ set: () => Promise.resolve({ status: 200 }) })
});

const mockSuperagent = {
    get: jestGlobal.fn(chainable),
    post: jestGlobal.fn(chainable),
    put: jestGlobal.fn(chainable),
    delete: jestGlobal.fn(chainable),
    patch: jestGlobal.fn(chainable)
};
jestGlobal.mock('superagent', () => mockSuperagent);

const svc = require('../../../../../middleware/fhir/base/base.service.js');

/**
 * These tests call the real batch/transaction handler directly (this module has no
 * ScopesManager/DI dependencies) with superagent mocked, so we can assert on the exact
 * destination URL the code constructs without making any real network call.
 */
describe('base.service batch - SSRF protection (SEC-1580-adjacent Gecko finding)', () => {
    beforeEach(() => {
        Object.values(mockSuperagent).forEach((fn) => fn.mockClear());
    });

    const makeReq = (entryOverrides = {}) => ({
        // Every one of these is attacker-suppliable in a real request; none of them should
        // ever influence which host the server's own loopback call is sent to.
        headers: { host: 'attacker-controlled.example.com:9999' },
        protocol: 'https',
        hostname: 'attacker-controlled.example.com',
        baseUrl: '',
        params: { base_version: '4_0_0' },
        body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
                {
                    request: { method: 'GET', url: 'Patient/123', ...entryOverrides },
                    resource: null
                }
            ]
        }
    });

    const makeRes = () => ({
        status: () => ({ json: jestGlobal.fn() }),
        req: { protocol: 'https', baseUrl: '', get: () => 'attacker-controlled.example.com:9999' }
    });

    test("destination URL always uses the server's own configured loopback address, never the caller-supplied Host header or req.hostname", () => {
        const expectedPort = process.env.PORT || process.env.SERVER_PORT;

        // createRequestPromises (where the fix lives) runs synchronously before the handler's
        // returned promise ever settles, so we don't need to await it here. Result-bundle assembly
        // (later, async) has an unrelated pre-existing bug (its dynamic schema require() doesn't
        // resolve, which leaves the returned promise permanently pending) - out of scope for this
        // fix, so this test never awaits that promise; it only asserts on what the fix changed.
        svc.batch(makeReq(), makeRes()).catch(() => {});

        expect(mockSuperagent.get).toHaveBeenCalledTimes(1);
        const destinationUrl = mockSuperagent.get.mock.calls[0][0];
        expect(destinationUrl).toBe(`http://127.0.0.1:${expectedPort}/4_0_0/Patient/123`);
        expect(destinationUrl).not.toContain('attacker-controlled');
        expect(destinationUrl.startsWith('http://')).toBe(true); // never https, matches the app's own plain-HTTP listener
    });

    test('rejects a bundle entry whose HTTP method is not in the allowlist', async () => {
        const req = makeReq({ method: 'TRACE' });

        await expect(svc.batch(req, makeRes())).rejects.toThrow(/Disallowed method/);
        expect(mockSuperagent.get).not.toHaveBeenCalled();
    });

    test('rejects a bundle entry whose url attempts path traversal', async () => {
        const req = makeReq({ url: '../../etc/passwd' });

        await expect(svc.batch(req, makeRes())).rejects.toThrow(/Disallowed or unsafe URL/);
        expect(mockSuperagent.get).not.toHaveBeenCalled();
    });

    test('rejects a bundle entry whose url is protocol-relative (absolute-URL bypass attempt)', async () => {
        const req = makeReq({ url: '//attacker.example.com/evil' });

        await expect(svc.batch(req, makeRes())).rejects.toThrow(/Disallowed or unsafe URL/);
        expect(mockSuperagent.get).not.toHaveBeenCalled();
    });

    test('allows a legitimate conditional search/update url with query-string characters', () => {
        const expectedPort = process.env.PORT || process.env.SERVER_PORT;

        svc.batch(makeReq({ url: 'Patient?identifier=http://example.org|123' }), makeRes()).catch(() => {});

        expect(mockSuperagent.get).toHaveBeenCalledTimes(1);
        const destinationUrl = mockSuperagent.get.mock.calls[0][0];
        expect(destinationUrl).toBe(
            `http://127.0.0.1:${expectedPort}/4_0_0/Patient?identifier=http://example.org|123`
        );
    });
});
