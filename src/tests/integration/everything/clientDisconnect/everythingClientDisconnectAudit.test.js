/**
 * An AuditEvent is written for $everything in every outcome: completed, client aborted after
 * some resources were streamed, and client aborted before any resource was streamed.
 */
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { FhirResponseStreamer } = require('../../../../utils/fhirResponseStreamer');
const {
    CLIENT_GONE_DEADLINE_MS,
    pollUntilAsync,
    buildPatient,
    buildObservation,
    abortOnFirstChunkAsync,
    holdStreamAfterFirstEntry
} = require('./clientDisconnectTestHelpers');

const OBSERVATION_COUNT = 20;
const PATIENT_ID = 'patAudit';
const EVERYTHING_URL = `/4_0_0/Patient/${PATIENT_ID}/$everything`;
const NO_COMPRESSION = { 'Accept-Encoding': 'identity' };

describe('$everything audit events by outcome', () => {
    let requestId;
    let request;
    let auditCollection;
    let postRequestProcessor;
    let auditLogger;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
        request = await createTestRequest((container) => {
            container.register('auditLogger', (c) => new AuditLogger({
                postRequestProcessor: c.postRequestProcessor,
                databaseBulkInserter: c.fastDatabaseBulkInserter,
                preSaveManager: c.preSaveManager,
                configManager: c.configManager
            }));
            return container;
        });
        const container = getTestContainer();
        postRequestProcessor = container.postRequestProcessor;
        auditLogger = container.auditLogger;
        const auditDb = await container.mongoDatabaseManager.getAuditDbAsync();
        auditCollection = auditDb.collection('AuditEvent_4_0_0');

        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([
                buildPatient(PATIENT_ID),
                ...Array.from({ length: OBSERVATION_COUNT }, (_, i) => buildObservation(PATIENT_ID, i))
            ])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });
        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();
        await auditCollection.deleteMany({});
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    const referencesOf = (events) => events.flatMap(
        (e) => (e.entity || []).map((x) => x.what?.reference).filter(Boolean)
    );

    /**
     * Audit tasks run after the response, so poll the collection until it has the expected number of
     * references (or the deadline passes) rather than asserting right after waitTillDone.
     * @param {number|null} expectedReferences null: wait for at least one event
     */
    async function readAuditEventsAsync (expectedReferences = null) {
        let events = [];
        await pollUntilAsync(async () => {
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            events = await auditCollection.find({}).toArray();
            return expectedReferences === null
                ? events.length > 0
                : referencesOf(events).length >= expectedReferences;
        });
        return events;
    }

    test('completed request: audit events list every resource and carry no outcome', async () => {
        const resp = await request.get(EVERYTHING_URL).set(getHeaders());
        expect(resp.status).toBe(200);

        const events = await readAuditEventsAsync(OBSERVATION_COUNT + 1);
        expect(referencesOf(events).length).toBe(OBSERVATION_COUNT + 1);
        events.forEach((e) => expect(e.outcome).toBeUndefined());
    });

    test('client aborts after the first entry: streamed resources are audited with outcome 4', async () => {
        const held = holdStreamAfterFirstEntry();

        await abortOnFirstChunkAsync(request.get(EVERYTHING_URL).set({ ...getHeaders(), ...NO_COMPRESSION }));

        const events = await readAuditEventsAsync(1);
        expect(held.writtenCount()).toBeLessThan(OBSERVATION_COUNT + 1);
        expect(referencesOf(events).length).toBe(held.writtenCount());
        events.forEach((e) => expect(e.outcome).toBe('4'));
    });

    test('client aborts before any entry is streamed: an audit event with outcome 4 is still written', async () => {
        let markRequestArrived;
        const requestArrived = new Promise((resolve) => { markRequestArrived = resolve; });
        let observedGone = false;
        jest.spyOn(FhirResponseStreamer.prototype, 'startAsync').mockImplementation(async function () {
            markRequestArrived();
            observedGone = await pollUntilAsync(() => this.isClientGone(), CLIENT_GONE_DEADLINE_MS);
        });

        const pending = request.get(EVERYTHING_URL).set({ ...getHeaders(), ...NO_COMPRESSION }).buffer(false);
        const done = pending.then(() => undefined, () => undefined);
        // abort only once the server is handling the request, before it streams anything
        await requestArrived;
        pending.abort();
        await done;

        const events = await readAuditEventsAsync();
        expect(observedGone).toBe(true);
        expect(events.length).toBeGreaterThan(0);
        events.forEach((e) => expect(e.outcome).toBe('4'));
    });
});
