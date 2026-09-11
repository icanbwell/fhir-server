'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn(),
    logWarn: jestObj.fn()
}));

const { CompositionLatestVersionTransform } = require('../../../../operations/streaming/compositionLatestVersionTransform');

describe('CompositionLatestVersionTransform', () => {
    const mockSignal = { aborted: false };
    const v2Source = 'https://www.icanbwell.com/intelligence-layer-databricks';
    const v3Source = 'https://www.icanbwell.com/fhir-composition-service';
    const otherSource = 'https://www.icanbwell.com/some-other-generator';

    const makeConfigManager = ({ enabled = true, sources = [v2Source, v3Source], maxGroups = 10000 } = {}) => ({
        enableCompositionLatestVersionDedup: enabled,
        compositionLatestVersionSources: sources,
        compositionLatestVersionMaxGroups: maxGroups,
        logStreamSteps: false
    });

    const makeTransform = (configOverrides = {}) => new CompositionLatestVersionTransform({
        signal: mockSignal,
        highWaterMark: 16,
        configManager: makeConfigManager(configOverrides),
        defaultSortId: '_uuid'
    });

    const makeComposition = ({ source, lastUpdated, subject = 'Patient/person.p1', typeCode = 'condition_summary_document', id, uuid }) => ({
        resourceType: 'Composition',
        id: id || `${source}-${lastUpdated}`,
        _uuid: uuid || id || `${source}-${lastUpdated}`,
        meta: { source, lastUpdated },
        subject: { reference: subject },
        type: { coding: [{ code: typeCode }] }
    });

    const flush = (transform) => new Promise((resolve) => transform._flush(resolve));
    const transformOne = (transform, resource) => new Promise((resolve) => transform._transform(resource, 'utf8', resolve));

    test('non-Composition resources pass through untouched and immediately', (done) => {
        const t = makeTransform();
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const patient = { resourceType: 'Patient', id: 'p1' };
        t._transform(patient, 'utf8', () => {
            expect(pushed).toEqual([patient]);
            done();
        });
    });

    test('Composition with a non-matching meta.source passes through untouched', (done) => {
        const t = makeTransform();
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const legacyV1 = makeComposition({ source: otherSource, lastUpdated: '2026-01-01T00:00:00Z' });
        t._transform(legacyV1, 'utf8', () => {
            expect(pushed).toEqual([legacyV1]);
            done();
        });
    });

    test('feature flag off: passes every Composition through untouched, even duplicates', async () => {
        const t = makeTransform({ enabled: false });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const older = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' });
        const newer = makeComposition({ source: v3Source, lastUpdated: '2026-02-01T00:00:00Z' });
        await transformOne(t, older);
        await transformOne(t, newer);
        await flush(t);

        expect(pushed).toEqual([older, newer]);
    });

    test('keeps only the Composition with the newest meta.lastUpdated per (subject, type) group', async () => {
        const t = makeTransform();
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const v2Copy = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', id: 'v2-copy' });
        const v3Copy = makeComposition({ source: v3Source, lastUpdated: '2026-02-01T00:00:00Z', id: 'v3-copy' });
        await transformOne(t, v2Copy);
        await transformOne(t, v3Copy);
        await flush(t);

        expect(pushed).toEqual([v3Copy]);
    });

    test('does not dedup across different subjects or different composition types', async () => {
        const t = makeTransform();
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const conditionForP1 = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.p1', typeCode: 'condition_summary_document', id: 'p1-condition' });
        const conditionForP2 = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.p2', typeCode: 'condition_summary_document', id: 'p2-condition' });
        const medicationForP1 = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.p1', typeCode: 'medication_summary_document', id: 'p1-medication' });

        for (const resource of [conditionForP1, conditionForP2, medicationForP1]) {
            await transformOne(t, resource);
        }
        await flush(t);

        expect(pushed).toEqual(expect.arrayContaining([conditionForP1, conditionForP2, medicationForP1]));
        expect(pushed).toHaveLength(3);
    });

    test('a resource missing subject/type is passed through immediately rather than dropped', (done) => {
        const t = makeTransform();
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const malformed = { resourceType: 'Composition', id: 'malformed', meta: { source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' } };
        t._transform(malformed, 'utf8', () => {
            expect(pushed).toEqual([malformed]);
            done();
        });
    });

    test('_transform short-circuits when signal aborted', (done) => {
        const t = new CompositionLatestVersionTransform({ signal: { aborted: true }, highWaterMark: 16, configManager: makeConfigManager(), defaultSortId: '_uuid' });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        t._transform(makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' }), 'utf8', () => {
            expect(pushed).toHaveLength(0);
            done();
        });
    });

    test('fails open (passes chunk through) if an internal error occurs while grouping', (done) => {
        const t = makeTransform();
        const pushed = [];
        t.push = (data) => pushed.push(data);
        t._groupKey = () => { throw new Error('boom'); };

        const composition = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z' });
        t._transform(composition, 'utf8', () => {
            expect(pushed).toEqual([composition]);
            done();
        });
    });

    test('emits buffered winners sorted by defaultSortId, not Map insertion order', async () => {
        const t = makeTransform();
        const pushed = [];
        t.push = (data) => pushed.push(data);

        // Group A's low-_uuid doc arrives first (Map insertion position 0), then group C's
        // lower-_uuid doc arrives (position 1), then group A's winning doc arrives with a HIGHER
        // _uuid than either -- Map.set on an existing key keeps its original iteration position,
        // so naive Map.values() order would emit A (_uuid 180) before C (_uuid 150), even though
        // the underlying cursor is sorted ascending by _uuid and downstream pagination assumes
        // emission order tracks that.
        const groupAFirstSeen = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.pA', typeCode: 'condition_summary_document', uuid: '100' });
        const groupC = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.pC', typeCode: 'condition_summary_document', uuid: '150' });
        const groupAWinner = makeComposition({ source: v3Source, lastUpdated: '2026-02-01T00:00:00Z', subject: 'Patient/person.pA', typeCode: 'condition_summary_document', uuid: '180' });

        await transformOne(t, groupAFirstSeen);
        await transformOne(t, groupC);
        await transformOne(t, groupAWinner);
        await flush(t);

        expect(pushed).toEqual([groupC, groupAWinner]);
    });

    test('falls back to passthrough once compositionLatestVersionMaxGroups is reached, bounding memory', async () => {
        const t = makeTransform({ maxGroups: 2 });
        const pushed = [];
        t.push = (data) => pushed.push(data);

        const groupA = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.pA', uuid: '1' });
        const groupB = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.pB', uuid: '2' });
        // a third, distinct group -- pushes size past the cap of 2, forcing an early drain
        const groupC = makeComposition({ source: v2Source, lastUpdated: '2026-01-01T00:00:00Z', subject: 'Patient/person.pC', uuid: '3' });
        // arrives after the cap trip, in permanent passthrough mode -- NOT deduped even though it
        // duplicates groupA, which was already flushed
        const groupADuplicateAfterCap = makeComposition({ source: v3Source, lastUpdated: '2026-02-01T00:00:00Z', subject: 'Patient/person.pA', uuid: '4' });

        await transformOne(t, groupA);
        await transformOne(t, groupB);
        await transformOne(t, groupC);
        await transformOne(t, groupADuplicateAfterCap);
        await flush(t);

        expect(pushed).toEqual([groupA, groupB, groupC, groupADuplicateAfterCap]);
    });
});
