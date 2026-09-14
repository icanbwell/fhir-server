'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { normalizeFhirBasePath } = require('../../../middleware/normalizeFhirBasePath');

describe('normalizeFhirBasePath', () => {
    const makeConfigManager = (enableFhirR4PathAlias) => ({
        enableFhirR4PathAlias,
        fhirBasePathAliases: enableFhirR4PathAlias ? { 'fhir/r4': '4_0_0' } : {}
    });

    const makeReqRes = (url) => {
        const req = { url, originalUrl: url };
        const res = {};
        const next = jestObj.fn();
        return { req, res, next };
    };

    describe('when the feature flag is off', () => {
        test('is a byte-identical pass-through for an alias-shaped url', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(false) });
            const { req, res, next } = makeReqRes('/fhir/r4/Patient/123');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/fhir/r4/Patient/123');
            expect(req.originalUrl).toStrictEqual('/fhir/r4/Patient/123');
            expect(req.clientOriginalUrl).toBeUndefined();
            expect(req.fhirBasePath).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith();
        });

        test('is a byte-identical pass-through for a canonical url', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(false) });
            const { req, res, next } = makeReqRes('/4_0_0/Patient/123');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/4_0_0/Patient/123');
            expect(req.originalUrl).toStrictEqual('/4_0_0/Patient/123');
            expect(next).toHaveBeenCalledTimes(1);
        });
    });

    describe('when the feature flag is on', () => {
        test('rewrites req.url and req.originalUrl, stashes req.fhirBasePath and req.clientOriginalUrl', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir/r4/Patient/123');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/4_0_0/Patient/123');
            expect(req.originalUrl).toStrictEqual('/4_0_0/Patient/123');
            expect(req.clientOriginalUrl).toStrictEqual('/fhir/r4/Patient/123');
            expect(req.fhirBasePath.canonicalVersion).toStrictEqual('4_0_0');
            expect(req.fhirBasePath.clientSegment).toStrictEqual('fhir/r4');
            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith();
        });

        test('matches case-insensitively but always echoes the canonical lowercase clientSegment', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir/R4/Patient/123');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/4_0_0/Patient/123');
            expect(req.fhirBasePath.clientSegment).toStrictEqual('fhir/r4');
            expect(next).toHaveBeenCalledTimes(1);
        });

        test('preserves a trailing slash', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir/r4/');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/4_0_0/');
        });

        test('handles the bare alias with no trailing segment', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir/r4');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/4_0_0');
        });

        test('does not match a segment that merely starts with the alias (/fhir/r4x)', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir/r4x/Patient');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/fhir/r4x/Patient');
            expect(req.fhirBasePath).toBeUndefined();
            expect(req.clientOriginalUrl).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        });

        test('does not match a beta-style segment (/fhir/r4beta)', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir/r4beta/Patient');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/fhir/r4beta/Patient');
            expect(req.fhirBasePath).toBeUndefined();
        });

        test('does not match the bare /fhir OAuth route (collision guard)', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/fhir');
            expect(req.fhirBasePath).toBeUndefined();
            expect(req.clientOriginalUrl).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        });

        test('does not match the /fhir OAuth route even with a query string', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir?resource=x');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/fhir?resource=x');
            expect(req.fhirBasePath).toBeUndefined();
        });

        test('leaves an unrelated path untouched', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/4_0_0/Patient/123');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/4_0_0/Patient/123');
            expect(req.fhirBasePath).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        });

        test('preserves the query string verbatim, including a token value with a pipe-delimited system URI', () => {
            const middleware = normalizeFhirBasePath({ configManager: makeConfigManager(true) });
            const { req, res, next } = makeReqRes('/fhir/r4/Patient?identifier=http://sys|code');

            middleware(req, res, next);

            expect(req.url).toStrictEqual('/4_0_0/Patient?identifier=http://sys|code');
        });
    });
});
