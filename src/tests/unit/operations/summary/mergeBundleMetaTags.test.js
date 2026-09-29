'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { mergeBundleMetaTags } = require('../../../../operations/summary/mergeBundleMetaTags');

describe('mergeBundleMetaTags', () => {
    describe('null/undefined handling', () => {
        test('returns null when both bundles are null', () => {
            expect(mergeBundleMetaTags(null, null)).toBeNull();
        });

        test('returns null when both bundles are undefined', () => {
            expect(mergeBundleMetaTags(undefined, undefined)).toBeNull();
        });

        test('returns bundle2 when bundle1 is null', () => {
            const bundle2 = { meta: { tag: [{ system: 'test', code: 'val' }] } };
            const result = mergeBundleMetaTags(null, bundle2);
            expect(result).toBe(bundle2);
        });

        test('returns bundle1 when bundle2 is null', () => {
            const bundle1 = { meta: { tag: [{ system: 'test', code: 'val' }] } };
            const result = mergeBundleMetaTags(bundle1, null);
            expect(result).toBe(bundle1);
        });

        test('returns bundle2 when bundle1 is undefined', () => {
            const bundle2 = { meta: { tag: [{ system: 'test', code: 'val' }] } };
            const result = mergeBundleMetaTags(undefined, bundle2);
            expect(result).toBe(bundle2);
        });

        test('returns bundle1 when bundle2 is undefined', () => {
            const bundle1 = { meta: { tag: [{ system: 'test', code: 'val' }] } };
            const result = mergeBundleMetaTags(bundle1, undefined);
            expect(result).toBe(bundle1);
        });
    });

    describe('tags without system property are dropped', () => {
        test('tags without system are silently excluded from merged result', () => {
            const bundle1 = {
                meta: {
                    tag: [
                        { code: 'no-system-tag', display: 'I have no system' },
                        { system: 'https://example.com/valid', code: 'valid' }
                    ]
                }
            };
            const bundle2 = { meta: { tag: [] } };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            expect(result.meta.tag).toHaveLength(1);
            expect(result.meta.tag[0].system).toBe('https://example.com/valid');
        });

        test('tags without system in bundle2 are also dropped', () => {
            const bundle1 = { meta: { tag: [] } };
            const bundle2 = {
                meta: {
                    tag: [
                        { code: 'orphan', display: 'no system' }
                    ]
                }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            expect(result.meta.tag).toHaveLength(0);
        });
    });

    describe('mutation behavior', () => {
        test('mutates bundle1 (mergedBundle = bundle1)', () => {
            const bundle1 = {
                resourceType: 'Bundle',
                meta: {
                    tag: [
                        { system: 'https://www.icanbwell.com/queryTime', display: '10' }
                    ]
                }
            };
            const bundle2 = {
                meta: {
                    tag: [
                        { system: 'https://www.icanbwell.com/queryTime', display: '5' }
                    ]
                }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            expect(result).toBe(bundle1);
            expect(bundle1.meta.tag[0].display).toBe('15');
        });
    });

    describe('queryTime tag merging', () => {
        test('adds numeric display values together', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryTime', display: '10.5' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryTime', display: '5.3' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const timeTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryTime');
            expect(parseFloat(timeTag.display)).toBeCloseTo(15.8);
        });

        test('handles non-numeric display values (parseFloat returns NaN, falls back to 0)', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryTime', display: 'abc' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryTime', display: '5' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const timeTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryTime');
            // parseFloat('abc') is NaN, || 0 makes it 0, so result is 0 + 5 = 5
            expect(timeTag.display).toBe('5');
        });

        test('handles missing display (uses default "0")', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryTime' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryTime', display: '7' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const timeTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryTime');
            expect(timeTag.display).toBe('7');
        });
    });

    describe('queryCollection tag merging', () => {
        test('joins codes with pipe separator (no spaces)', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryCollection', code: 'Patient_4_0_0' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryCollection', code: 'Observation_4_0_0' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const collTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryCollection');
            expect(collTag.code).toBe('Patient_4_0_0|Observation_4_0_0');
        });

        test('returns tag2 when tag1 code is empty', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryCollection', code: '' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryCollection', code: 'Observation' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const collTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryCollection');
            expect(collTag.code).toBe('Observation');
        });

        test('returns tag1 when tag2 code is empty', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryCollection', code: 'Patient' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryCollection', code: '' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const collTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryCollection');
            expect(collTag.code).toBe('Patient');
        });
    });

    describe('query tag merging', () => {
        test('joins display values with " | " separator', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/query', display: 'Patient?id=1' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/query', display: 'Observation?patient=1' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const queryTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/query');
            expect(queryTag.display).toBe('Patient?id=1 | Observation?patient=1');
        });

        test('returns tag2 when tag1 display is empty', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/query', display: '' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/query', display: 'query2' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const queryTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/query');
            expect(queryTag.display).toBe('query2');
        });

        test('returns tag1 when tag2 display is empty', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/query', display: 'query1' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/query', display: '' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const queryTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/query');
            expect(queryTag.display).toBe('query1');
        });
    });

    describe('queryExplain tag merging', () => {
        test('merges JSON arrays from both bundles', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: '["step1","step2"]' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: '["step3"]' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const explainTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryExplain');
            expect(JSON.parse(explainTag.display)).toEqual(['step1', 'step2', 'step3']);
        });

        test('returns tag1 when JSON parsing fails on display', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: 'not valid json' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: '["valid"]' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const explainTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryExplain');
            expect(explainTag.display).toBe('not valid json');
        });

        test('returns tag1 when parsed values are not arrays (e.g., objects)', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: '{"key":"val"}' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: '{"key2":"val2"}' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const explainTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryExplain');
            // Non-arrays fall through to the final return tag1
            expect(explainTag.display).toBe('{"key":"val"}');
        });

        test('returns tag2 when tag1 display is empty', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: '' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplain', display: '["data"]' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const explainTag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryExplain');
            expect(explainTag.display).toBe('["data"]');
        });
    });

    describe('queryExplainSimple tag merging', () => {
        test('uses same merging logic as queryExplain', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplainSimple', display: '["a"]' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://www.icanbwell.com/queryExplainSimple', display: '["b"]' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const tag = result.meta.tag.find(t => t.system === 'https://www.icanbwell.com/queryExplainSimple');
            expect(JSON.parse(tag.display)).toEqual(['a', 'b']);
        });
    });

    describe('unknown system tags', () => {
        test('keeps tag from first bundle for unknown systems', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://example.com/custom', code: 'first', display: 'display1' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://example.com/custom', code: 'second', display: 'display2' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            const tag = result.meta.tag.find(t => t.system === 'https://example.com/custom');
            expect(tag.code).toBe('first');
            expect(tag.display).toBe('display1');
        });
    });

    describe('non-overlapping tags', () => {
        test('includes tags from both bundles when systems differ', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://example.com/systemA', code: 'a' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://example.com/systemB', code: 'b' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            expect(result.meta.tag).toHaveLength(2);
            expect(result.meta.tag.find(t => t.system === 'https://example.com/systemA')).toBeTruthy();
            expect(result.meta.tag.find(t => t.system === 'https://example.com/systemB')).toBeTruthy();
        });
    });

    describe('bundles without meta or tags', () => {
        test('handles bundle1 without meta property', () => {
            const bundle1 = { resourceType: 'Bundle' };
            const bundle2 = {
                meta: { tag: [{ system: 'https://example.com/test', code: 'val' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            expect(result.meta.tag).toHaveLength(1);
            expect(result.meta.tag[0].code).toBe('val');
        });

        test('handles bundle2 without meta property', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://example.com/test', code: 'val' }] }
            };
            const bundle2 = { resourceType: 'Bundle' };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            expect(result.meta.tag).toHaveLength(1);
            expect(result.meta.tag[0].code).toBe('val');
        });

        test('handles both bundles without meta', () => {
            const bundle1 = { resourceType: 'Bundle' };
            const bundle2 = { resourceType: 'Bundle' };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            expect(result.meta.tag).toEqual([]);
        });
    });

    describe('source property cleanup', () => {
        test('does not include internal source property in output tags', () => {
            const bundle1 = {
                meta: { tag: [{ system: 'https://example.com/a', code: 'a' }] }
            };
            const bundle2 = {
                meta: { tag: [{ system: 'https://example.com/b', code: 'b' }] }
            };
            const result = mergeBundleMetaTags(bundle1, bundle2);
            result.meta.tag.forEach(tag => {
                expect(tag).not.toHaveProperty('source');
            });
        });
    });
});
