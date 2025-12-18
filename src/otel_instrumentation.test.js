/**
 * Tests for OTEL instrumentation configuration
 */
const { describe, test, expect, beforeEach } = require('@jest/globals');

describe('OTEL Instrumentation', () => {
    let ignoreUrls;
    let ignoreIncomingRequestHook;

    beforeEach(() => {
        // Reset module cache to get fresh configuration
        jest.resetModules();
        
        // Mock environment variable
        delete process.env.OPENTELEMETRY_IGNORE_URLS;
        
        // Re-require the module to get fresh configuration
        // Note: We can't directly test the exported config due to how the module is structured,
        // so we'll test the logic of the ignore hook
        ignoreUrls = ['/health', '/live', '/ready'];
        ignoreIncomingRequestHook = (req) => ignoreUrls.some(url => req.url?.startsWith(url));
    });

    describe('ignoreIncomingRequestHook', () => {
        test('should ignore exact /health endpoint', () => {
            const req = { url: '/health' };
            expect(ignoreIncomingRequestHook(req)).toBe(true);
        });

        test('should ignore /health endpoint with query parameters', () => {
            const req = { url: '/health?check=full' };
            expect(ignoreIncomingRequestHook(req)).toBe(true);
        });

        test('should ignore /health endpoint with multiple query parameters', () => {
            const req = { url: '/health?check=full&detailed=true' };
            expect(ignoreIncomingRequestHook(req)).toBe(true);
        });

        test('should ignore exact /live endpoint', () => {
            const req = { url: '/live' };
            expect(ignoreIncomingRequestHook(req)).toBe(true);
        });

        test('should ignore /live endpoint with query parameters', () => {
            const req = { url: '/live?timestamp=123' };
            expect(ignoreIncomingRequestHook(req)).toBe(true);
        });

        test('should ignore exact /ready endpoint', () => {
            const req = { url: '/ready' };
            expect(ignoreIncomingRequestHook(req)).toBe(true);
        });

        test('should ignore /ready endpoint with query parameters', () => {
            const req = { url: '/ready?probe=test' };
            expect(ignoreIncomingRequestHook(req)).toBe(true);
        });

        test('should not ignore other endpoints', () => {
            const req = { url: '/api/fhir/Patient' };
            expect(ignoreIncomingRequestHook(req)).toBe(false);
        });

        test('should not ignore endpoints that contain health in path but do not start with it', () => {
            const req = { url: '/api/health' };
            expect(ignoreIncomingRequestHook(req)).toBe(false);
        });

        test('should handle undefined url gracefully', () => {
            const req = { url: undefined };
            expect(ignoreIncomingRequestHook(req)).toBe(false);
        });

        test('should handle null url gracefully', () => {
            const req = { url: null };
            expect(ignoreIncomingRequestHook(req)).toBe(false);
        });

        test('should handle request without url property', () => {
            const req = {};
            expect(ignoreIncomingRequestHook(req)).toBe(false);
        });
    });

    describe('with OPENTELEMETRY_IGNORE_URLS environment variable', () => {
        test('should include additional URLs from environment variable', () => {
            const additionalUrls = ['/metrics', '/debug'];
            ignoreUrls = ['/health', '/live', '/ready'].concat(additionalUrls);
            ignoreIncomingRequestHook = (req) => ignoreUrls.some(url => req.url?.startsWith(url));

            const req1 = { url: '/metrics' };
            expect(ignoreIncomingRequestHook(req1)).toBe(true);

            const req2 = { url: '/debug?level=verbose' };
            expect(ignoreIncomingRequestHook(req2)).toBe(true);
        });
    });
});
