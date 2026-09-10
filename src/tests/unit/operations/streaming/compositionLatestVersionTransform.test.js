'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

const { CompositionLatestVersionTransform } = require('../../../../operations/streaming/compositionLatestVersionTransform');

describe('CompositionLatestVersionTransform', () => {
    const mockSignal = { aborted: false };
    const v2Source = 'https://www.icanbwell.com/';
    const v3Source = 'https://www.icanbwell.com/fhir-composition-service';
    const otherSource = 'https://www.icanbwell.com/some-other-generator';

    const makeConfigManager = ({ enabled = true, sources = [v2Source, v3Source] } = {}) => ({
        enableCompositionLatestVersionDedup: enabled,
        compositionLatestVersionSources: sources,
        logStreamSteps: false
    });

    const makeComposition = ({ source, lastUpdated, subject = 'Patient/person.p1', typeCode = 'condition_summary_document', id }) => ({
        resourceType: 'Composition',
        id: id || `${source}-${lastUpdated}`,
        meta: { source, lastUpdated },
        subject: { reference: subject },
        type: { coding: [{ code: typeCode }] }
    });

    const flush = (transform) => new Promise((resolve) => transform._flush(resolve));

    test('non-Composition resources pass through untouched and immediately', (done) => {
        const t = new CompositionLatestVersionTransform({ signal: mockSignal, highWaterMark: 16, configManager: makeConfigManager() });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const patient = { resourceType: 'Patient', id: 'p1' };
        t._transform(patient, 'utf8', () => {
            expect(pushed).toEqual([patient]);
            done();
        });
    });

    test('Composition with a non-matching meta.source passes through untouched', (done) => {
        const t = new CompositionLatestVersionTransform({ signal: mockSignal, highWaterMark: 16, configManager: makeConfigManager() });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const legacyV1 = makeComposition({ source: otherSource, lastUpdated: '2026-01-01T00:00:00Z' });
        t._transform(legacyV1, 'utf8', () => {
            expect(pushed).toEqual([legacyV1]);
            done();
        });
    });

    test('feature flag off: passes every Composition through untouched, even duplicates', async () => {
        const t = new CompositionLatestVersionTransform({ signal: mockSignal, highWaterMark: 16, configManager: makeConfigManager({ enabled: false }) });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const older = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' });
        const newer = makeComposition({ source: v3Source, lastUpdated: '2026-02-01T00:00:00Z' });
        await new Promise((resolve) => t._transform(older, 'utf8', resolve));
        await new Promise((resolve) => t._transform(newer, 'utf8', resolve));
        await flush(t);

        expect(pushed).toEqual([older, newer]);
    });

    test('keeps only the Composition with the newest meta.lastUpdated per (subject, type) group', async () => {
        const t = new CompositionLatestVersionTransform({ signal: mockSignal, highWaterMark: 16, configManager: makeConfigManager() });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const v2Copy = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', id: 'v2-copy' });
        const v3Copy = makeComposition({ source: v3Source, lastUpdated: '2026-02-01T00:00:00Z', id: 'v3-copy' });
        await new Promise((resolve) => t._transform(v2Copy, 'utf8', resolve));
        await new Promise((resolve) => t._transform(v3Copy, 'utf8', resolve));
        await flush(t);

        expect(pushed).toEqual([v3Copy]);
    });

    test('does not dedup across different subjects or different composition types', async () => {
        const t = new CompositionLatestVersionTransform({ signal: mockSignal, highWaterMark: 16, configManager: makeConfigManager() });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const conditionForP1 = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.p1', typeCode: 'condition_summary_document', id: 'p1-condition' });
        const conditionForP2 = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.p2', typeCode: 'condition_summary_document', id: 'p2-condition' });
        const medicationForP1 = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.p1', typeCode: 'medication_summary_document', id: 'p1-medication' });

        for (const resource of [conditionForP1, conditionForP2, medicationForP1]) {
            await new Promise((resolve) => t._transform(resource, 'utf8', resolve));
        }
        await flush(t);

        expect(pushed).toEqual(expect.arrayContaining([conditionForP1, conditionForP2, medicationForP1]));
        expect(pushed).toHaveLength(3);
    });

    test('a resource missing subject/type is passed through immediately rather than dropped', (done) => {
        const t = new CompositionLatestVersionTransform({ signal: mockSignal, highWaterMark: 16, configManager: makeConfigManager() });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const malformed = { resourceType: 'Composition', id: 'malformed', meta: { source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' } };
        t._transform(malformed, 'utf8', () => {
            expect(pushed).toEqual([malformed]);
            done();
        });
    });

    test('_transform short-circuits when signal aborted', (done) => {
        const t = new CompositionLatestVersionTransform({ signal: { aborted: true }, highWaterMark: 16, configManager: makeConfigManager() });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        t._transform(makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' }), 'utf8', () => {
            expect(pushed).toHaveLength(0);
            done();
        });
    });

    test('fails open (passes chunk through) if an internal error occurs while grouping', (done) => {
        const t = new CompositionLatestVersionTransform({ signal: mockSignal, highWaterMark: 16, configManager: makeConfigManager() });
        const pushed = [];
        t.push = (data) => pushed.push(data);
        t._groupKey = () => { throw new Error('boom'); };

        const composition = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' });
        t._transform(composition, 'utf8', () => {
            expect(pushed).toEqual([composition]);
            done();
        });
    });
});
