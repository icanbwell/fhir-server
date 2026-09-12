'use strict';

const { describe, test, expect } = require('@jest/globals');
const { FhirBasePath } = require('../../../../utils/url/fhirBasePath');
const { FhirResponseUrlBuilder } = require('../../../../utils/url/fhirResponseUrlBuilder');

describe('FhirResponseUrlBuilder', () => {
    const canonicalBasePath = FhirBasePath.canonical();
    const aliasBasePath = new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' });

    describe('build() - form x basePath x externalUrlPrefix matrix', () => {
        const cases = [
            {
                label: 'canonical, no prefix, absolute',
                basePath: canonicalBasePath,
                externalUrlPrefix: undefined,
                form: 'absolute',
                expected: 'http://example.com/4_0_0/Patient/1'
            },
            {
                label: 'canonical, no prefix, path',
                basePath: canonicalBasePath,
                externalUrlPrefix: undefined,
                form: 'path',
                expected: '/4_0_0/Patient/1'
            },
            {
                label: 'canonical, no prefix, relative',
                basePath: canonicalBasePath,
                externalUrlPrefix: undefined,
                form: 'relative',
                expected: '4_0_0/Patient/1'
            },
            {
                label: 'alias, no prefix, absolute',
                basePath: aliasBasePath,
                externalUrlPrefix: undefined,
                form: 'absolute',
                expected: 'http://example.com/fhir/r4/Patient/1'
            },
            {
                label: 'alias, no prefix, path',
                basePath: aliasBasePath,
                externalUrlPrefix: undefined,
                form: 'path',
                expected: '/fhir/r4/Patient/1'
            },
            {
                label: 'alias, no prefix, relative',
                basePath: aliasBasePath,
                externalUrlPrefix: undefined,
                form: 'relative',
                expected: 'fhir/r4/Patient/1'
            },
            {
                label: 'canonical, prefix set, absolute (prefix wins, form ignored)',
                basePath: canonicalBasePath,
                externalUrlPrefix: 'http://example.com',
                form: 'absolute',
                expected: 'http://example.com/Patient/1'
            },
            {
                label: 'canonical, prefix set, path (prefix wins, form ignored)',
                basePath: canonicalBasePath,
                externalUrlPrefix: 'http://example.com',
                form: 'path',
                expected: 'http://example.com/Patient/1'
            },
            {
                label: 'canonical, prefix set, relative (prefix wins, form ignored)',
                basePath: canonicalBasePath,
                externalUrlPrefix: 'http://example.com',
                form: 'relative',
                expected: 'http://example.com/Patient/1'
            },
            {
                label: 'alias + prefix set - prefix wins absolutely, no /fhir/r4 leakage',
                basePath: aliasBasePath,
                externalUrlPrefix: 'http://example.com',
                form: 'absolute',
                expected: 'http://example.com/Patient/1'
            }
        ];

        test.each(cases)('$label', ({ basePath, externalUrlPrefix, form, expected }) => {
            const builder = new FhirResponseUrlBuilder({
                protocol: 'http',
                host: 'example.com',
                basePath,
                externalUrlPrefix
            });
            expect(builder.build('Patient/1', { form })).toStrictEqual(expected);
        });
    });

    describe('build() with a rooted canonical input path', () => {
        test('strips and re-prefixes with the alias', () => {
            const builder = new FhirResponseUrlBuilder({
                protocol: 'https',
                host: 'fhir.icanbwell.com',
                basePath: aliasBasePath
            });
            expect(builder.build('/4_0_0/Patient/1', { form: 'absolute' })).toStrictEqual(
                'https://fhir.icanbwell.com/fhir/r4/Patient/1'
            );
        });
    });

    describe('build() with an absolute canonical URL input (exportById re-projection)', () => {
        test('discards the persisted origin and re-bases with the current builder host/basePath', () => {
            const builder = new FhirResponseUrlBuilder({
                protocol: 'https',
                host: 'fhir.icanbwell.com',
                basePath: aliasBasePath
            });
            const persisted = 'https://fhir.icanbwell.com/4_0_0/$export/abc123';
            expect(builder.build(persisted, { form: 'absolute' })).toStrictEqual(
                'https://fhir.icanbwell.com/fhir/r4/$export/abc123'
            );
        });
    });

    describe("build('') - implementation.url case", () => {
        test('returns the base with no trailing slash, canonical', () => {
            const builder = new FhirResponseUrlBuilder({
                protocol: 'https',
                host: 'fhir.icanbwell.com',
                basePath: canonicalBasePath
            });
            expect(builder.build('', { form: 'absolute' })).toStrictEqual(
                'https://fhir.icanbwell.com/4_0_0'
            );
        });

        test('returns the base with no trailing slash, alias', () => {
            const builder = new FhirResponseUrlBuilder({
                protocol: 'https',
                host: 'fhir.icanbwell.com',
                basePath: aliasBasePath
            });
            expect(builder.build('', { form: 'absolute' })).toStrictEqual(
                'https://fhir.icanbwell.com/fhir/r4'
            );
        });
    });

    describe('defaults', () => {
        test('defaults to the canonical base path when none is supplied', () => {
            const builder = new FhirResponseUrlBuilder({ protocol: 'http', host: 'example.com' });
            expect(builder.build('Patient/1', { form: 'relative' })).toStrictEqual(
                '4_0_0/Patient/1'
            );
        });

        test('defaults form to absolute', () => {
            const builder = new FhirResponseUrlBuilder({ protocol: 'http', host: 'example.com' });
            expect(builder.build('Patient/1')).toStrictEqual('http://example.com/4_0_0/Patient/1');
        });
    });

    describe('fromRequest', () => {
        test('uses req.fhirBasePath, req.protocol and req.get(host), never externalUrlPrefix', () => {
            const req = {
                protocol: 'https',
                fhirBasePath: aliasBasePath,
                get: (name) => (name === 'host' ? 'fhir.icanbwell.com' : undefined)
            };
            const builder = FhirResponseUrlBuilder.fromRequest(req);
            expect(builder.build('Patient/1', { form: 'relative' })).toStrictEqual(
                'fhir/r4/Patient/1'
            );
            expect(builder.externalUrlPrefix).toBeUndefined();
        });

        test('defaults to canonical basePath when req.fhirBasePath is unset', () => {
            const req = {
                protocol: 'http',
                get: (name) => (name === 'host' ? 'example.com' : undefined)
            };
            const builder = FhirResponseUrlBuilder.fromRequest(req);
            expect(builder.build('Patient/1', { form: 'relative' })).toStrictEqual(
                '4_0_0/Patient/1'
            );
        });
    });

    describe('fromRequestInfo', () => {
        test('honours externalReqUrlPrefix over the alias', () => {
            const requestInfo = {
                protocol: 'https',
                host: 'fhir.icanbwell.com',
                basePath: aliasBasePath,
                externalReqUrlPrefix: 'http://example.com'
            };
            const builder = FhirResponseUrlBuilder.fromRequestInfo(requestInfo);
            expect(builder.build('Patient/1')).toStrictEqual('http://example.com/Patient/1');
        });

        test('mirrors the alias when no externalReqUrlPrefix is set', () => {
            const requestInfo = {
                protocol: 'https',
                host: 'fhir.icanbwell.com',
                basePath: aliasBasePath,
                externalReqUrlPrefix: undefined
            };
            const builder = FhirResponseUrlBuilder.fromRequestInfo(requestInfo);
            expect(builder.build('Patient/1')).toStrictEqual(
                'https://fhir.icanbwell.com/fhir/r4/Patient/1'
            );
        });

        test('defaults to canonical basePath when requestInfo.basePath is unset', () => {
            const requestInfo = {
                protocol: 'http',
                host: 'example.com',
                externalReqUrlPrefix: undefined
            };
            const builder = FhirResponseUrlBuilder.fromRequestInfo(requestInfo);
            expect(builder.build('Patient/1')).toStrictEqual('http://example.com/4_0_0/Patient/1');
        });
    });
});
