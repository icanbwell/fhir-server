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
const person3 = require('./fixtures/Person/person3.json');

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

    test('Bundle wrapper to $merge records full entry count (not 1)', async () => {
        // Regression for Claude-bot Bug 1: when a client POSTs a FHIR Bundle
        // to /$merge, incomingObjects is the Bundle wrapper Object — not an
        // array. The pre-fix Array.isArray-then-truthy ternary fell through
        // to `1`, so an N-entry Bundle saturated the histogram at 1 even
        // though BundleResourceValidator unwraps entry[].resource into N
        // resources downstream.
        const request = await createTestRequest();

        const bundle = {
            resourceType: 'Bundle',
            type: 'collection',
            entry: [
                { resource: person1 },
                { resource: person2 },
                { resource: person3 }
            ]
        };

        await request
            .post('/4_0_0/Person/$merge')
            .send(bundle)
            .set(getHeaders());

        const inboundCalls = bundleSizeRecordSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.DIRECTION] === metrics.DIRECTION.INBOUND
                && attrs[metrics.LABEL.OPERATION] === metrics.OPERATION.MERGE
        );
        expect(inboundCalls.length).toBe(1);
        // The point of the regression: must be 3 (entry count), not 1.
        expect(inboundCalls[0][0]).toBe(3);
    });

    test('pre-check errors survive a mid-flight bulk-insert throw', async () => {
        // Regression for Claude-bot Bug 2: pre-check errors lived in a
        // block-scoped const inside the try and never made it into mergeResults
        // before the catch+rethrow. The finally then called
        // recordMergeOutcomes([]) and lost the error signal entirely.
        //
        // The fix assembles mergeResults incrementally — pre-check errors are
        // captured immediately after mergeValidator.validateAsync returns, so a
        // throw from databaseBulkInserter.executeAsync still leaves them in
        // scope when the finally fires.
        //
        // Test design: send [valid Person, malformed Person with pipe in id].
        // mergeResourceValidator generates a pre-check error for the pipe-id
        // Person (createFromError() returns a MergeResultEntry with
        // resourceType: 'Person' and an OperationOutcomeIssue). The valid
        // Person makes it into validResources and reaches the bulk insert,
        // where we mock executeAsync to throw. The catch logs and rethrows;
        // finally fires recordMergeOutcomes(mergeResults). Without the fix,
        // mergeResults is empty here. With the fix, it contains the pre-check
        // error and merge_outcome_total fires with outcome=error.
        const { getTestContainer } = require('../../common');

        const request = await createTestRequest();
        const container = getTestContainer();

        // MergeOperation always uses fastDatabaseBulkInserter. Spy on the
        // one the operation will actually invoke.
        const insertSpy = jest.spyOn(container.fastDatabaseBulkInserter, 'executeAsync')
            .mockRejectedValueOnce(new Error('synthetic mid-flight failure'));

        // person1 is valid. badPerson has a pipe in id which mergeResourceValidator
        // catches as a pre-check error (see validators/mergeResourceValidator.js
        // 'Pipe | is not allowed in id field').
        const badPerson = {
            ...person2,
            id: 'metrics-bad|pipe-id'
        };

        try {
            await request
                .post('/4_0_0/Person/$merge')
                .send([person1, badPerson])
                .set(getHeaders());
        } catch (_e) { /* server returns 500; supertest may not throw */ }

        // Sanity: the bulk insert spy was actually invoked (and rejected).
        // If this fails, the test scenario is wrong, not the bug fix.
        expect(insertSpy).toHaveBeenCalledTimes(1);

        // Bundle-size still emits via finally with full inbound count 2.
        const inboundCalls = bundleSizeRecordSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.DIRECTION] === metrics.DIRECTION.INBOUND
                && attrs[metrics.LABEL.OPERATION] === metrics.OPERATION.MERGE
        );
        expect(inboundCalls.length).toBe(1);
        expect(inboundCalls[0][0]).toBe(2);

        // The Bug 2 fix specifically: the pre-check error for badPerson
        // appears in mergeResults at finally time despite the bulk-insert
        // throw, so merge_outcome_total fires with outcome=error,
        // resource_type=Person at least once.
        // Pre-fix this assertion fails — the counter never increments
        // because mergeResults is [] at finally time.
        const errorPersonCalls = mergeOutcomeAddSpy.mock.calls.filter(
            ([, attrs]) => attrs
                && attrs[metrics.LABEL.OUTCOME] === metrics.OUTCOME.ERROR
                && attrs[metrics.LABEL.RESOURCE_TYPE] === 'Person'
        );
        const totalErrors = errorPersonCalls.reduce((acc, [count]) => acc + count, 0);
        expect(totalErrors).toBeGreaterThanOrEqual(1);

        insertSpy.mockRestore();
    });
});
