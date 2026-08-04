const { describe, test, expect } = require('@jest/globals');
const {
    tallyMergeOutcomes,
    worstSeverity,
    OUTCOME,
    UNKNOWN
} = require('../../../utils/metrics');

describe('metrics pure helpers', () => {
    describe('tallyMergeOutcomes', () => {
        test('returns empty Map for null/undefined/empty input', () => {
            expect(tallyMergeOutcomes(null).size).toBe(0);
            expect(tallyMergeOutcomes(undefined).size).toBe(0);
            expect(tallyMergeOutcomes([]).size).toBe(0);
        });

        test('counts created/updated/error per (outcome, resource_type)', () => {
            const entries = [
                { created: true, resourceType: 'Person' },
                { created: true, resourceType: 'Person' },
                { updated: true, resourceType: 'Person' },
                { issue: { severity: 'error' }, resourceType: 'Patient' },
                { created: true, resourceType: 'Patient' }
            ];
            const tallies = tallyMergeOutcomes(entries);
            expect(tallies.get(`${OUTCOME.CREATED}|Person`)).toBe(2);
            expect(tallies.get(`${OUTCOME.UPDATED}|Person`)).toBe(1);
            expect(tallies.get(`${OUTCOME.ERROR}|Patient`)).toBe(1);
            expect(tallies.get(`${OUTCOME.CREATED}|Patient`)).toBe(1);
            expect(tallies.size).toBe(4);
        });

        test('skips placeholder unchanged entries (no created/updated/issue)', () => {
            const entries = [
                { created: false, updated: false, resourceType: 'Person' },
                { created: true, resourceType: 'Person' }
            ];
            const tallies = tallyMergeOutcomes(entries);
            expect(tallies.get(`${OUTCOME.CREATED}|Person`)).toBe(1);
            expect(tallies.size).toBe(1);
        });

        test('skips entries whose resourceType is OperationOutcome (Bundle-400 guard)', () => {
            // BundleResourceValidator returns the OperationOutcome itself as a
            // pre-check error when bundle validation fails. Tallying that would
            // mislabel `OperationOutcome` as a resource_type.
            const entries = [
                { issue: { severity: 'error' }, resourceType: 'OperationOutcome' },
                { created: true, resourceType: 'Person' }
            ];
            const tallies = tallyMergeOutcomes(entries);
            expect(tallies.get(`${OUTCOME.CREATED}|Person`)).toBe(1);
            expect(tallies.has(`${OUTCOME.ERROR}|OperationOutcome`)).toBe(false);
            expect(tallies.size).toBe(1);
        });

        test('falls back to UNKNOWN when resourceType is missing', () => {
            const entries = [{ created: true }];
            const tallies = tallyMergeOutcomes(entries);
            expect(tallies.get(`${OUTCOME.CREATED}|${UNKNOWN}`)).toBe(1);
        });

        test('handles null entries inside the array safely', () => {
            const entries = [null, { created: true, resourceType: 'Person' }, undefined];
            const tallies = tallyMergeOutcomes(entries);
            expect(tallies.get(`${OUTCOME.CREATED}|Person`)).toBe(1);
            expect(tallies.size).toBe(1);
        });

        test('per-window: caller passes one batch, gets one tally — does not double-count', () => {
            // Streaming caller passes only the new entries from a batch; we should
            // tally exactly that window. Over two batches of 100 each, we expect
            // 200 created total when the caller invokes us twice with disjoint slices.
            const batch1 = Array.from({ length: 100 }, () => ({ created: true, resourceType: 'Person' }));
            const batch2 = Array.from({ length: 100 }, () => ({ created: true, resourceType: 'Person' }));
            const t1 = tallyMergeOutcomes(batch1);
            const t2 = tallyMergeOutcomes(batch2);
            expect(t1.get(`${OUTCOME.CREATED}|Person`)).toBe(100);
            expect(t2.get(`${OUTCOME.CREATED}|Person`)).toBe(100);
        });

        test('outcome priority: created wins over updated wins over issue', () => {
            // Defensive: if MergeResultEntry has both flags set, the derivation
            // order is created > updated > issue. Lock that in.
            const entries = [
                { created: true, updated: true, issue: { severity: 'error' }, resourceType: 'Person' }
            ];
            const tallies = tallyMergeOutcomes(entries);
            expect(tallies.get(`${OUTCOME.CREATED}|Person`)).toBe(1);
            expect(tallies.size).toBe(1);
        });
    });

    describe('worstSeverity', () => {
        test('returns null for null/undefined input', () => {
            expect(worstSeverity(null)).toBe(null);
            expect(worstSeverity(undefined)).toBe(null);
        });

        test('returns null when no issues are present', () => {
            expect(worstSeverity({ issue: [] })).toBe(null);
            expect(worstSeverity({ issue: undefined })).toBe(null);
        });

        test('ranks error > warning > information', () => {
            const oo = {
                issue: [
                    { severity: 'information' },
                    { severity: 'warning' },
                    { severity: 'error' }
                ]
            };
            expect(worstSeverity(oo)).toBe('error');
        });

        test('returns warning when no error present', () => {
            const oo = {
                issue: [
                    { severity: 'information' },
                    { severity: 'warning' }
                ]
            };
            expect(worstSeverity(oo)).toBe('warning');
        });

        test('accepts single-issue (non-array) shape', () => {
            // validateResourceFromServerAsync sometimes assigns a single
            // OperationOutcomeIssue to operationOutcome.issue.
            const oo = { issue: { severity: 'error' } };
            expect(worstSeverity(oo)).toBe('error');
        });

        test('ignores unknown severity strings (rank 0)', () => {
            const oo = {
                issue: [
                    { severity: 'fatal' },
                    { severity: 'warning' }
                ]
            };
            expect(worstSeverity(oo)).toBe('warning');
        });

        test('handles issue items missing severity', () => {
            const oo = {
                issue: [
                    {},
                    { severity: 'error' }
                ]
            };
            expect(worstSeverity(oo)).toBe('error');
        });
    });
});
