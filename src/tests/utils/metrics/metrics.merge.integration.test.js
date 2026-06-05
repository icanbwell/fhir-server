// Integration tests for the merge metrics boundaries.
// Covers both non-streaming (mergeAsync) and streaming (mergeAsyncStream).
//
// We spy on the OTel instrument itself (`metrics.mergeOutcomeCounter.add`,
// `metrics.bundleSizeHistogram.record`), NOT on the recording wrapper
// `recordMergeOutcomes` / `recordInboundBundleSize`. The production code
// destructures these wrappers at module load
// (`const { recordMergeOutcomes } = require('./metrics')`), so any spy on the
// wrapper after-the-fact is a false-green: the destructured binding already
// captured the original function. Spying on the property of the OTel
// instrument exposed on the module object is the only seam that catches the
// real call.
const person1 = require('./fixtures/Person/person1.json');
const person2 = require('./fixtures/Person/person2.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const metrics = require('../../../utils/metrics');

const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('metrics merge boundary', () => {
    let mergeOutcomeAddSpy;
    let bundleSizeRecordSpy;

    beforeEach(async () => {
        await commonBeforeEach();
        mergeOutcomeAddSpy = jest.spyOn(metrics.mergeOutcomeCounter, 'add');
        bundleSizeRecordSpy = jest.spyOn(metrics.bundleSizeHistogram, 'record');
    });

    afterEach(async () => {
        mergeOutcomeAddSpy.mockRestore();
        bundleSizeRecordSpy.mockRestore();
        await commonAfterEach();
    });

    test('emits merge_outcome and bundle_size on success path', async () => {
        const request = await createTestRequest();

        const resp = await request
            .post('/4_0_0/Person/$merge')
            .send([person1, person2])
            .set(getHeaders());

        expect(resp).toHaveStatusCode(200);

        // Bundle size: emitted exactly once with inbound + merge labels and
        // count matching the array length.
        const inboundCalls = bundleSizeRecordSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.DIRECTION] === metrics.DIRECTION.INBOUND
                && attrs[metrics.LABEL.OPERATION] === metrics.OPERATION.MERGE
        );
        expect(inboundCalls.length).toBe(1);
        expect(inboundCalls[0][0]).toBe(2);

        // Merge outcomes: tally is summed per (outcome, resource_type), so
        // both Persons being created collapse to a single .add(2, ...) call.
        const createdPersonCalls = mergeOutcomeAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.OUTCOME] === metrics.OUTCOME.CREATED
                && attrs[metrics.LABEL.RESOURCE_TYPE] === 'Person'
        );
        const totalCreated = createdPersonCalls.reduce((acc, [count]) => acc + count, 0);
        expect(totalCreated).toBe(2);
    });

    test('emits even when no resources merge cleanly (Bundle-400 skip)', async () => {
        // A Bundle that fails 400 validation produces one OperationOutcome
        // pre-check entry, which tallyMergeOutcomes skips by resourceType.
        // Bundle size still emits because finally runs unconditionally.
        const request = await createTestRequest();

        const badBundle = {
            resourceType: 'Bundle',
            type: 'collection',
            // Intentionally malformed entry — missing resource.resourceType.
            entry: [{ resource: { id: 'broken' } }]
        };

        await request
            .post('/4_0_0/Person/$merge')
            .send(badBundle)
            .set(getHeaders());

        // Bundle size still emitted (finally is load-bearing).
        const inboundCalls = bundleSizeRecordSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.DIRECTION] === metrics.DIRECTION.INBOUND
        );
        expect(inboundCalls.length).toBe(1);

        // Merge outcome counter must NOT increment OperationOutcome as a
        // resource_type — that was the round-3 latent mislabel bug.
        const ooCalls = mergeOutcomeAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.RESOURCE_TYPE] === 'OperationOutcome'
        );
        expect(ooCalls.length).toBe(0);
    });

    test('rethrow path: bundle_size still emits when bulk-insert throws mid-flight', async () => {
        // Regression-revert smoke: this test fails if mergeAsync's emission is
        // moved from the `finally` block to a success-return point. The catch
        // logs and rethrows, so anything not in finally silently loses signal
        // for production error paths.
        const { getTestContainer } = require('../../common');

        const request = await createTestRequest();
        const container = getTestContainer();
        const bulkInserter = container.databaseBulkInserter;
        const insertSpy = jest.spyOn(bulkInserter, 'executeAsync')
            .mockRejectedValueOnce(new Error('synthetic mid-flight failure'));

        try {
            await request
                .post('/4_0_0/Person/$merge')
                .send([person1, person2])
                .set(getHeaders());
        } catch (_e) { /* server returns 500; supertest may not throw */ }

        // The bulk-insert was forced to throw, so the catch block ran and
        // rethrew. Bundle-size must still have emitted via finally.
        const inboundCalls = bundleSizeRecordSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.DIRECTION] === metrics.DIRECTION.INBOUND
                && attrs[metrics.LABEL.OPERATION] === metrics.OPERATION.MERGE
        );
        expect(inboundCalls.length).toBe(1);
        expect(inboundCalls[0][0]).toBe(2);

        insertSpy.mockRestore();
    });

    test('streaming NDJSON merge emits once across multiple BATCH_SIZE windows', async () => {
        // BATCH_SIZE in mergeAsyncStream is 100. Sending 150 resources forces
        // at least one mid-pipeline insertAndLog plus a flush() call.
        // Single emission point at the pipeline finally must report the full
        // 150 inbound count and 150 created outcomes — not one per batch
        // (that was the prior streaming N-count bug).
        const request = await createTestRequest();

        const persons = Array.from({ length: 150 }, (_, i) => ({
            resourceType: 'Person',
            id: `metrics-stream-${i.toString().padStart(4, '0')}`,
            meta: {
                versionId: '1',
                source: 'bwell',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' }
                ]
            },
            name: [{ use: 'official', family: 'Stream', given: [`P${i}`] }]
        }));

        const ndjsonString = persons.map((p) => JSON.stringify(p)).join('\n');

        await request
            .post('/4_0_0/Person/1/$merge')
            .send(ndjsonString)
            .set({
                ...getHeaders(),
                'Content-Type': 'application/fhir+ndjson',
                Accept: 'application/fhir+ndjson'
            });

        // Inbound bundle size: emitted exactly once with NDJSON operation
        // and total count of resources we sent.
        const inboundNdjsonCalls = bundleSizeRecordSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.DIRECTION] === metrics.DIRECTION.INBOUND
                && attrs[metrics.LABEL.OPERATION] === metrics.OPERATION.NDJSON
        );
        expect(inboundNdjsonCalls.length).toBe(1);
        expect(inboundNdjsonCalls[0][0]).toBe(150);

        // Merge outcomes: 150 created Persons collapsed into one or more
        // .add() calls, summed across all attribute-matching invocations.
        const createdPersonCalls = mergeOutcomeAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.OUTCOME] === metrics.OUTCOME.CREATED
                && attrs[metrics.LABEL.RESOURCE_TYPE] === 'Person'
        );
        const totalCreated = createdPersonCalls.reduce((acc, [count]) => acc + count, 0);
        expect(totalCreated).toBe(150);
    });
});
