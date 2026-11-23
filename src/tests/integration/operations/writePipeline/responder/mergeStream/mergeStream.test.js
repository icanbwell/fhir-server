const patientResource = require('../merge/fixtures/patient.json');
const patientUpdatedResource = require('../merge/fixtures/patientUpdated.json');
const patientWithoutIdResource = require('../merge/fixtures/patientWithoutId.json');
const patientOtherTenantResource = require('../merge/fixtures/patientOtherTenant.json');
const observationResource = require('../merge/fixtures/observation.json');

const expectedMixed = require('./fixtures/expected/mixed.json');
const expectedStoredCreated = require('./fixtures/expected/storedCreated.json');
const expectedUnchanged = require('./fixtures/expected/unchanged.json');
const expectedUpdated = require('./fixtures/expected/updated.json');
const expectedAccessForbidden = require('./fixtures/expected/accessForbidden.json');
const expectedSameResourceTwice = require('./fixtures/expected/sameResourceTwice.json');
const expectedStoredSameResourceTwice = require('./fixtures/expected/storedSameResourceTwice.json');
const expectedTwoBatches = require('./fixtures/expected/twoBatches.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    parseNdjsonResponse
} = require('../../../../common');
const { MergeStream } = require('../../../../../../operations/writePipeline/responder/mergeStream');
const { WritePipeline } = require('../../../../../../operations/writePipeline/writePipeline');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * Builds `count` synthetic Patients with the ids `stream-0` onwards, owned by `client`.
 */
const buildPatients = (count) => Array.from({ length: count }, (_, index) => ({
    resourceType: 'Patient',
    id: `stream-${index}`,
    meta: {
        source: 'http://example.com/source',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' }
        ]
    },
    name: [{ family: 'Stream', given: [`Patient${index}`] }]
}));

/**
 * Streams the resources to Patient `$merge` as NDJSON, one resource per line, and asks for an
 * NDJSON response.
 */
const streamResources = (request, resources, headers = getHeaders()) =>
    request
        .post('/4_0_0/Patient/$merge')
        .send(resources.map((resource) => JSON.stringify(resource)).join('\n'))
        .set({
            ...headers,
            'Content-Type': 'application/fhir+ndjson',
            Accept: 'application/fhir+ndjson'
        });

/**
 * Posts the resource to Patient `$merge` as JSON.
 */
const mergeResource = (request, resource) =>
    request.post('/4_0_0/Patient/$merge').send(resource).set(getHeaders());

/**
 * Sends `$merge` to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'merge' : '';
};

/**
 * Expands each case into one run per path.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => PATHS.map((path) => ({ ...testCase, path })));

/**
 * Returns the id of each result line, with null for a line that has no id.
 */
const resultIds = (results) => results.map((result) => result.id ?? null);

describe('streaming $merge parity between the old and the new write path', () => {
    const originalOperations = process.env.WRITE_PIPELINE_OPERATIONS;

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        if (originalOperations === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = originalOperations;
        }
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'streams a created resource, a resource without an id and a second created one',
            previous: [],
            lines: [patientResource, patientWithoutIdResource, observationResource],
            headers: getHeaders(),
            expected: expectedMixed,
            stored: { id: 'parity-1', expected: expectedStoredCreated }
        },
        {
            name: 'streams an unchanged resource',
            previous: [patientResource],
            lines: [patientResource],
            headers: getHeaders(),
            expected: expectedUnchanged
        },
        {
            name: 'streams an updated resource',
            previous: [patientResource],
            lines: [patientUpdatedResource],
            headers: getHeaders(),
            expected: expectedUpdated
        },
        {
            name: 'streams an error for a resource the caller cannot access',
            previous: [],
            lines: [patientOtherTenantResource],
            headers: getHeaders('user/*.* access/client.*'),
            expected: expectedAccessForbidden
        },
        {
            name: 'streams one result for the same resource sent on two lines',
            previous: [],
            lines: [patientResource, patientUpdatedResource],
            headers: getHeaders(),
            expected: expectedSameResourceTwice,
            stored: { id: 'parity-1', expected: expectedStoredSameResourceTwice }
        },
        {
            name: 'streams the results of more than one batch',
            previous: [],
            lines: buildPatients(101),
            headers: getHeaders(),
            expected: expectedTwoBatches
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        previous,
        lines,
        headers,
        expected,
        stored
    }) => {
        const request = await createTestRequest();
        useWritePath('old');
        for (const resource of previous) {
            await mergeResource(request, resource).expect(200);
        }
        useWritePath(path);

        const resp = await streamResources(request, lines, headers);

        expect(resp.status).toBe(200);
        expect(resultIds(parseNdjsonResponse(resp))).toStrictEqual(resultIds(expected));
        expect(resp).toHaveResponse(expected);
        if (stored) {
            const storedResp = await request.get(`/4_0_0/Patient/${stored.id}`).set(getHeaders());
            expect(storedResp.status).toBe(200);
            expect(storedResp).toHaveResponse(stored.expected);
        }
    });

    test('routes streaming $merge to the new path when the switch is on', async () => {
        const request = await createTestRequest();
        const streamSpy = jest.spyOn(MergeStream.prototype, 'createStreamHandler');
        const runSpy = jest.spyOn(WritePipeline.prototype, 'runAsync');
        useWritePath('new');

        await streamResources(request, [patientResource]).expect(200);

        expect(streamSpy).toHaveBeenCalledTimes(1);
        expect(runSpy).not.toHaveBeenCalled();
    });

    test('keeps streaming $merge on the old path when the switch is off', async () => {
        const request = await createTestRequest();
        const streamSpy = jest.spyOn(MergeStream.prototype, 'createStreamHandler');
        useWritePath('old');

        await streamResources(request, [patientResource]).expect(200);

        expect(streamSpy).not.toHaveBeenCalled();
    });
});
