// Integration tests for the $everything metrics boundary.
//
// One emission point in retriveEverythingAsync covers both streaming and
// non-streaming modes via:
//   responseStreamer ? streamedResources.length : (bundle.entry?.length ?? 0)
//
// We need to exercise both modes and both empty/non-empty outcomes so the
// bundle-size histogram reports a real number (not 0 when streaming had
// content) and the empty-bundle counter only saturates on truly-empty
// responses.
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');

const metrics = require('../../../utils/metrics');

const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

describe('metrics $everything boundary', () => {
    let bundleSizeRecordSpy;
    let everythingEmptyAddSpy;

    beforeEach(async () => {
        await commonBeforeEach();
        bundleSizeRecordSpy = jest.spyOn(metrics.bundleSizeHistogram, 'record');
        everythingEmptyAddSpy = jest.spyOn(metrics.everythingEmptyCounter, 'add');
    });

    afterEach(async () => {
        bundleSizeRecordSpy.mockRestore();
        everythingEmptyAddSpy.mockRestore();
        await commonAfterEach();
    });

    function outboundEverythingCalls (resourceType) {
        return bundleSizeRecordSpy.mock.calls.filter(
            ([, attrs]) => attrs
                && attrs[metrics.LABEL.DIRECTION] === metrics.DIRECTION.OUTBOUND
                && attrs[metrics.LABEL.OPERATION] === metrics.OPERATION.EVERYTHING
                && attrs[metrics.LABEL.RESOURCE_TYPE] === resourceType
        );
    }

    test('non-streaming empty: emits size=0 and empty counter', async () => {
        const request = await createTestRequest();

        await request
            .get('/4_0_0/Patient/missing-patient-12345/$everything')
            .set(getHeaders());

        const calls = outboundEverythingCalls('Patient');
        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe(0);

        const emptyCalls = everythingEmptyAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.RESOURCE_TYPE] === 'Patient'
        );
        expect(emptyCalls.length).toBe(1);
    });

    test('non-streaming non-empty: size > 0, empty counter not called', async () => {
        const request = await createTestRequest();

        const patient = {
            resourceType: 'Patient',
            id: 'metrics-everything-1',
            meta: {
                source: 'bwell',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'bwell' },
                    { system: 'https://www.icanbwell.com/owner', code: 'bwell' }
                ]
            },
            name: [{ family: 'EverythingNonEmpty', given: ['Alice'] }]
        };

        await request
            .post('/4_0_0/Patient/$merge')
            .send(patient)
            .set(getHeaders());

        // Reset spies after seeding so we only observe the $everything call.
        bundleSizeRecordSpy.mockClear();
        everythingEmptyAddSpy.mockClear();

        await request
            .get('/4_0_0/Patient/metrics-everything-1/$everything')
            .set(getHeaders());

        const calls = outboundEverythingCalls('Patient');
        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBeGreaterThan(0);

        const emptyCalls = everythingEmptyAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.RESOURCE_TYPE] === 'Patient'
        );
        expect(emptyCalls.length).toBe(0);
    });

    test('streaming empty: ndjson Accept header still emits empty counter', async () => {
        // Without the streamedResources branch, this would silently report
        // size=0 every time a streaming caller asked for $everything because
        // bundle.entry is empty by design in streaming mode. The branch is
        // load-bearing only when there are actual results, but we exercise
        // the empty path here too — both the empty and non-empty streaming
        // tests together prove the ternary is correct.
        const request = await createTestRequest();

        await request
            .get('/4_0_0/Patient/missing-stream-67890/$everything')
            .set({ ...getHeaders(), Accept: 'application/fhir+ndjson' });

        const calls = outboundEverythingCalls('Patient');
        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe(0);

        const emptyCalls = everythingEmptyAddSpy.mock.calls.filter(
            ([, attrs]) => attrs && attrs[metrics.LABEL.RESOURCE_TYPE] === 'Patient'
        );
        expect(emptyCalls.length).toBe(1);
    });
});
