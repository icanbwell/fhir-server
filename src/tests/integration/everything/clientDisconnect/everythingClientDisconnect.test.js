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
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');
const {
    pollUntilAsync,
    buildPatient,
    buildObservation,
    abortOnFirstChunkAsync,
    holdStreamAfterFirstEntry
} = require('./clientDisconnectTestHelpers');

const OBSERVATION_COUNT = 40;
const PATIENT_ID = 'patDisconnect';

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
            .send([
                buildPatient(PATIENT_ID),
                ...Array.from({ length: OBSERVATION_COUNT }, (_, i) => buildObservation(PATIENT_ID, i))
            ])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const held = holdStreamAfterFirstEntry();
        const closeSpy = jest.spyOn(DatabaseCursor.prototype, 'close');

        // abort the client as soon as the first bytes arrive
        await abortOnFirstChunkAsync(
            request
                .get(`/4_0_0/Patient/${PATIENT_ID}/$everything`)
                .set({ ...getHeaders(), 'Accept-Encoding': 'identity' })
        );

        // the server notices the abort, stops, and closes every cursor it opened
        expect(await pollUntilAsync(() => closeSpy.mock.calls.length > 0)).toBe(true);
        expect(held.writtenCount()).toBeLessThan(OBSERVATION_COUNT + 1);

        // a follow-up request is served fully: connections were released and nothing is stuck
        jest.restoreAllMocks();
        const followUp = await request
            .get(`/4_0_0/Patient/${PATIENT_ID}/$everything`)
            .set(getHeaders());
        expect(followUp.status).toBe(200);
        expect(followUp.body.entry.length).toBe(OBSERVATION_COUNT + 1);
    });
});
