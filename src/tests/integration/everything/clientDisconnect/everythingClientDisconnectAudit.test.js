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

const OBSERVATION_COUNT = 20;
const SECURITY = [
    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
    { system: 'https://www.icanbwell.com/access', code: 'bwell' }
];

const patient = {
    resourceType: 'Patient',
    id: 'patAudit',
    birthDate: '2017-01-01',
    gender: 'female',
    name: [{ use: 'usual', family: 'TEST', given: ['TEST'] }],
    meta: { source: 'bwell', security: SECURITY }
};

const observation = (id) => ({
    resourceType: 'Observation',
    id: `obs-${id}`,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
    subject: { reference: 'Patient/patAudit' },
    meta: { source: 'bwell', security: SECURITY }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
            .send([patient, ...Array.from({ length: OBSERVATION_COUNT }, (_, i) => observation(i))])
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

    const headersNoCompression = () => ({ ...getHeaders(), 'Accept-Encoding': 'identity' });

    async function readAuditEventsAsync () {
        // audit tasks run after the aborted request; give them time to be queued, then drain
        await sleep(300);
        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await sleep(300);
        await postRequestProcessor.waitTillDoneAsync({ requestId });
        await auditLogger.flushAsync();
        return await auditCollection.find({}).toArray();
    }

    const referencesOf = (events) => events.flatMap(
        (e) => (e.entity || []).map((x) => x.what?.reference).filter(Boolean)
    );

    test('completed request: audit events list every resource and carry no outcome', async () => {
        const resp = await request.get('/4_0_0/Patient/patAudit/$everything').set(getHeaders());
        expect(resp.status).toBe(200);

        const events = await readAuditEventsAsync();
        expect(events.length).toBeGreaterThan(0);
        expect(referencesOf(events).length).toBe(OBSERVATION_COUNT + 1);
        events.forEach((e) => expect(e.outcome).toBeUndefined());
    });

    test('client aborts after the first entry: streamed resources are audited with outcome 4', async () => {
        const originalWrite = FhirResponseStreamer.prototype.writeBundleEntryAsync;
        let written = 0;
        jest.spyOn(FhirResponseStreamer.prototype, 'writeBundleEntryAsync').mockImplementation(
            async function (args) {
                await originalWrite.call(this, args);
                written += 1;
                if (written === 1) {
                    const deadline = Date.now() + 5000;
                    while (!this.isClientGone() && Date.now() < deadline) {
                        await sleep(10);
                    }
                }
            }
        );

        await request
            .get('/4_0_0/Patient/patAudit/$everything')
            .set(headersNoCompression())
            .buffer(false)
            .parse((res, callback) => {
                res.once('data', () => res.destroy());
                res.on('close', () => callback(new Error('client aborted')));
            })
            .catch(() => undefined);

        const events = await readAuditEventsAsync();
        expect(written).toBeLessThan(OBSERVATION_COUNT + 1);
        expect(events.length).toBeGreaterThan(0);
        expect(referencesOf(events).length).toBe(written);
        events.forEach((e) => expect(e.outcome).toBe('4'));
    });

    test('client aborts before any entry is streamed: an audit event with outcome 4 is still written', async () => {
        let observedGone = false;
        jest.spyOn(FhirResponseStreamer.prototype, 'startAsync').mockImplementation(async function () {
            const deadline = Date.now() + 5000;
            while (!this.isClientGone() && Date.now() < deadline) {
                await sleep(10);
            }
            observedGone = this.isClientGone();
        });

        const pending = request
            .get('/4_0_0/Patient/patAudit/$everything')
            .set(headersNoCompression())
            .buffer(false);
        const done = pending.then(() => undefined, () => undefined);
        await sleep(500);
        pending.abort();
        await done;

        const events = await readAuditEventsAsync();
        expect(observedGone).toBe(true);
        expect(events.length).toBeGreaterThan(0);
        events.forEach((e) => expect(e.outcome).toBe('4'));
    });
});
