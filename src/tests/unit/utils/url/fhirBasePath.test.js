'use strict';

const { describe, test, expect } = require('@jest/globals');
const { FhirBasePath } = require('../../../../utils/url/fhirBasePath');

describe('FhirBasePath', () => {
    describe('canonical()', () => {
        test('has both fields set to 4_0_0', () => {
            const basePath = FhirBasePath.canonical();
            expect(basePath.canonicalVersion).toStrictEqual('4_0_0');
            expect(basePath.clientSegment).toStrictEqual('4_0_0');
            expect(basePath.isAlias).toStrictEqual(false);
        });

        test('is frozen', () => {
            const basePath = FhirBasePath.canonical();
            expect(Object.isFrozen(basePath)).toStrictEqual(true);
        });
    });

    describe('isAlias', () => {
        test('is true when clientSegment differs from canonicalVersion', () => {
            const basePath = new FhirBasePath({
                canonicalVersion: '4_0_0',
                clientSegment: 'fhir/r4'
            });
            expect(basePath.isAlias).toStrictEqual(true);
        });
    });

    describe('stripVersionSegment', () => {
        const canonical = FhirBasePath.canonical();
        const alias = new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' });

        test('strips a version-relative path unchanged (no segment to strip)', () => {
            expect(canonical.stripVersionSegment('Patient/1')).toStrictEqual('Patient/1');
            expect(alias.stripVersionSegment('Patient/1')).toStrictEqual('Patient/1');
        });

        test('strips a rooted canonical path', () => {
            expect(canonical.stripVersionSegment('/4_0_0/Patient/1')).toStrictEqual('/Patient/1');
            expect(alias.stripVersionSegment('/4_0_0/Patient/1')).toStrictEqual('/Patient/1');
        });

        test('strips a rooted alias path', () => {
            expect(alias.stripVersionSegment('/fhir/r4/Patient/1')).toStrictEqual('/Patient/1');
        });

        test('strips the version segment from an absolute URL', () => {
            expect(
                canonical.stripVersionSegment('https://fhir.icanbwell.com/4_0_0/$export/123')
            ).toStrictEqual('https://fhir.icanbwell.com/$export/123');
            expect(
                alias.stripVersionSegment('https://fhir.icanbwell.com/fhir/r4/$export/123')
            ).toStrictEqual('https://fhir.icanbwell.com/$export/123');
        });

        test('is idempotent', () => {
            const once = canonical.stripVersionSegment('/4_0_0/Patient/1');
            expect(canonical.stripVersionSegment(once)).toStrictEqual(once);
        });

        test('preserves a query string byte-for-byte, including a token value with a pipe-delimited system URI', () => {
            const input = '/4_0_0/Patient?identifier=http://sys|code';
            expect(canonical.stripVersionSegment(input)).toStrictEqual(
                '/Patient?identifier=http://sys|code'
            );
        });

        test('does not touch a version-looking segment that is not anchored at the start', () => {
            expect(canonical.stripVersionSegment('/Patient/4_0_0/foo')).toStrictEqual(
                '/Patient/4_0_0/foo'
            );
            expect(
                canonical.stripVersionSegment('/CodeSystem/server-behavior/4_0_0')
            ).toStrictEqual('/CodeSystem/server-behavior/4_0_0');
        });

        test('a mid-path version-looking segment is left untouched (anchoring, not global replace)', () => {
            // RESOURCE_HIDDEN_TAG.SYSTEM ('https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior',
            // src/constants.js) happens to place its '4_0_0' segment immediately after the host, so it is
            // indistinguishable in shape from a strippable response URL - which is exactly why this helper
            // must never be handed resource *content*, only request/response *paths*. What this helper
            // guarantees is anchoring: a naive `.replace('4_0_0', ...)` would also corrupt an occurrence
            // buried deeper in the path (not immediately after the origin); this assertion pins that a
            // non-leading occurrence is never touched.
            const withBuriedVersionSegment =
                'https://fhir.icanbwell.com/CodeSystem/4_0_0/server-behavior';
            expect(canonical.stripVersionSegment(withBuriedVersionSegment)).toStrictEqual(
                withBuriedVersionSegment
            );
        });
    });

    describe('toClientPath', () => {
        test('canonical prefixes with 4_0_0', () => {
            expect(FhirBasePath.canonical().toClientPath('Patient/1')).toStrictEqual(
                '/4_0_0/Patient/1'
            );
        });

        test('alias prefixes with fhir/r4', () => {
            const alias = new FhirBasePath({ canonicalVersion: '4_0_0', clientSegment: 'fhir/r4' });
            expect(alias.toClientPath('Patient/1')).toStrictEqual('/fhir/r4/Patient/1');
        });

        test('handles an empty relative path with no trailing slash', () => {
            expect(FhirBasePath.canonical().toClientPath('')).toStrictEqual('/4_0_0');
        });

        test('handles a relative path already carrying a leading slash', () => {
            expect(FhirBasePath.canonical().toClientPath('/Patient/1')).toStrictEqual(
                '/4_0_0/Patient/1'
            );
        });
    });
});
