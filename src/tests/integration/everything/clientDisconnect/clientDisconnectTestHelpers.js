/**
 * Shared fixtures and helpers for the $everything client-disconnect integration tests.
 */
const { FhirResponseStreamer } = require('../../../../utils/fhirResponseStreamer');
const { jest } = require('@jest/globals');

const POLL_INTERVAL_MS = 10;
const CLIENT_GONE_DEADLINE_MS = 5000;
const POLL_DEADLINE_MS = 8000;

const SECURITY = [
    { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
    { system: 'https://www.icanbwell.com/access', code: 'bwell' }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until condition() is truthy or the deadline passes
 * @param {() => Promise<boolean>|boolean} condition
 * @param {number} [deadlineMs]
 * @return {Promise<boolean>} whether the condition was met
 */
async function pollUntilAsync (condition, deadlineMs = POLL_DEADLINE_MS) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        if (await condition()) {
            return true;
        }
        await sleep(POLL_INTERVAL_MS);
    }
    return Boolean(await condition());
}

/**
 * @param {string} patientId
 * @return {Object}
 */
function buildPatient (patientId) {
    return {
        resourceType: 'Patient',
        id: patientId,
        birthDate: '2017-01-01',
        gender: 'female',
        name: [{ use: 'usual', family: 'TEST', given: ['TEST'] }],
        meta: { source: 'bwell', security: SECURITY }
    };
}

/**
 * @param {string} patientId
 * @param {number} index
 * @return {Object}
 */
function buildObservation (patientId, index) {
    return {
        resourceType: 'Observation',
        id: `obs-${index}`,
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
        subject: { reference: `Patient/${patientId}` },
        meta: { source: 'bwell', security: SECURITY }
    };
}

/**
 * Applies the chunk-level abort to a supertest request: destroys the client socket on the first data chunk.
 * @param {import('supertest').Test} test
 * @return {Promise<void>} settles once the aborted request has ended
 */
function abortOnFirstChunkAsync (test) {
    return test
        .buffer(false)
        .parse((res, callback) => {
            res.once('data', () => res.destroy());
            res.on('close', () => callback(new Error('client aborted')));
        })
        .then(() => undefined, () => undefined);
}

/**
 * After the first bundle entry is written, holds the stream until the server sees the client gone.
 * @return {{writtenCount: () => number}}
 */
function holdStreamAfterFirstEntry () {
    const originalWrite = FhirResponseStreamer.prototype.writeBundleEntryAsync;
    let written = 0;
    jest.spyOn(FhirResponseStreamer.prototype, 'writeBundleEntryAsync').mockImplementation(
        async function (args) {
            await originalWrite.call(this, args);
            written += 1;
            if (written === 1) {
                await pollUntilAsync(() => this.isClientGone(), CLIENT_GONE_DEADLINE_MS);
            }
        }
    );
    return { writtenCount: () => written };
}

module.exports = {
    POLL_DEADLINE_MS,
    CLIENT_GONE_DEADLINE_MS,
    sleep,
    pollUntilAsync,
    buildPatient,
    buildObservation,
    abortOnFirstChunkAsync,
    holdStreamAfterFirstEntry
};
