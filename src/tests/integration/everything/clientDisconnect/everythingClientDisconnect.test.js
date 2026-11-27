/**
 * $everything stops and closes its cursors when the client aborts mid-stream, and the server is
 * left healthy for the next request (pool connections released, no crash).
 */
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { FhirResponseStreamer } = require('../../../../utils/fhirResponseStreamer');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

const OBSERVATION_COUNT = 40;

function observation (id) {
    return {
        resourceType: 'Observation',
        id: `obs-${id}`,
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
        subject: { reference: 'Patient/patDisconnect' },
        meta: {
            source: 'bwell',
            security: [
                { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
                { system: 'https://www.icanbwell.com/access', code: 'bwell' }
            ]
        }
    };
}

const patient = {
    resourceType: 'Patient',
    id: 'patDisconnect',
    birthDate: '2017-01-01',
    gender: 'female',
    name: [{ use: 'usual', family: 'TEST', given: ['TEST'] }],
    meta: {
        source: 'bwell',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
            { system: 'https://www.icanbwell.com/access', code: 'bwell' }
        ]
    }
};

describe('$everything client disconnect', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    test('aborting mid-stream stops the work, closes the cursors, and leaves the server usable', async () => {
        const request = await createTestRequest();
        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([patient, ...Array.from({ length: OBSERVATION_COUNT }, (_, i) => observation(i))])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        // after the first entry is written, hold the stream until the server has seen the client go
        const originalWrite = FhirResponseStreamer.prototype.writeBundleEntryAsync;
        let entriesWritten = 0;
        let goneObserved = false;
        jest.spyOn(FhirResponseStreamer.prototype, 'writeBundleEntryAsync').mockImplementation(
            async function (args) {
                await originalWrite.call(this, args);
                entriesWritten += 1;
                if (entriesWritten === 1) {
                    const deadline = Date.now() + 5000;
                    while (!this.isClientGone() && Date.now() < deadline) {
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                    goneObserved = this.isClientGone();
                }
            }
        );
        const closeSpy = jest.spyOn(DatabaseCursor.prototype, 'close');

        // abort the client as soon as the first bytes arrive
        const pending = request
            .get('/4_0_0/Patient/patDisconnect/$everything')
            .set({ ...getHeaders(), 'Accept-Encoding': 'identity' })
            .buffer(false)
            .parse((res, callback) => {
                res.once('data', () => res.destroy());
                res.on('close', () => callback(new Error('client aborted')));
            });
        await pending.catch(() => undefined);

        // the server notices the abort, stops, and closes every cursor it opened
        const deadline = Date.now() + 8000;
        while (closeSpy.mock.calls.length === 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(goneObserved).toBe(true);
        expect(closeSpy.mock.calls.length).toBeGreaterThan(0);
        expect(entriesWritten).toBeLessThan(OBSERVATION_COUNT + 1);

        // a follow-up request is served fully: connections were released and nothing is stuck
        jest.restoreAllMocks();
        const followUp = await request
            .get('/4_0_0/Patient/patDisconnect/$everything')
            .set(getHeaders());
        expect(followUp.status).toBe(200);
        expect(followUp.body.entry.length).toBe(OBSERVATION_COUNT + 1);
    });
});
