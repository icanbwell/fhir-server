const deepcopy = require('deepcopy');

const patientResource = require('./fixtures/patient.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

/**
 * The environment variables a test changes, restored after every test.
 */
const ENVIRONMENT_KEYS = ['WRITE_PIPELINE_OPERATIONS', 'REPLACE_RETRIES', 'SKIP_HANDLE_CONCURRENCY'];

/**
 * The `_uuid` the server derives for the stored Patient of `patient.json`.
 */
const PATIENT_UUID = generateUUIDv5(`${patientResource.id}|client`);

/**
 * The id of the Patient that two PUTs race to create.
 */
const CREATED_ID = 'put-concurrency-created';

/**
 * The `_uuid` the server derives for the Patient that two PUTs race to create.
 */
const CREATED_UUID = generateUUIDv5(`${CREATED_ID}|client`);

/**
 * How many times to poll the history collection for the rows a write queues after its response.
 */
const HISTORY_POLL_ATTEMPTS = 20;

/**
 * Returns a copy of `patient.json` with the given id, `meta.source` and top-level fields.
 */
const patientWith = ({ id = patientResource.id, source = patientResource.meta.source, ...changes }) => {
    const resource = { ...deepcopy(patientResource), ...changes, id };
    resource.meta.source = source;
    return resource;
};

/**
 * The body the caller PUTs: the stored Patient renamed, with no `gender`.
 */
const callerBody = (id) => patientWith({ id, name: [{ family: 'Caller', given: ['Gamma'] }] });

/**
 * The body a competing writer PUTs: a different name and a `gender` that only it writes.
 */
const competitorBody = (id) =>
    patientWith({
        id,
        source: 'http://example.com/winner',
        name: [{ family: 'Winner', given: ['Delta'] }],
        gender: 'female'
    });

/**
 * Returns the MongoDB collection the server stores Patients in.
 */
const patientCollection = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType: 'Patient'
    });
    return db.collection('Patient_4_0_0');
};

/**
 * Reads the stored Patient with the given `_uuid` straight from MongoDB.
 */
const readStored = async (uuid) => (await patientCollection()).findOne({ _uuid: uuid });

/**
 * Writes a competing version of the stored Patient straight to MongoDB: the next `versionId`, with
 * the given fields set.
 */
const writeCompetingVersion = async (uuid, fields = {}) => {
    const stored = await readStored(uuid);
    await (await patientCollection()).updateOne(
        { _uuid: uuid },
        { $set: { 'meta.versionId': `${parseInt(stored.meta.versionId) + 1}`, ...fields } }
    );
};

/**
 * Waits until every post-request task the server has queued has finished.
 */
const waitForPostRequestTasks = () =>
    getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });

/**
 * Reads the `versionId` of every history row of the Patient with the given `_uuid`, oldest first,
 * once the post-request tasks are done, polling until there are `expectedCount` rows.
 */
const readHistoryVersions = async (uuid, expectedCount) => {
    await waitForPostRequestTasks();
    const db = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
    const read = async () =>
        (
            await db
                .collection('Patient_4_0_0_History')
                .find({ 'resource._uuid': uuid })
                .toArray()
        )
            .map((row) => row.resource.meta.versionId)
            .sort((a, b) => parseInt(a) - parseInt(b));
    let versions = await read();
    for (let attempt = 0; attempt < HISTORY_POLL_ATTEMPTS && versions.length < expectedCount; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        versions = await read();
    }
    return versions;
};

/**
 * Stores `patient.json` through `$merge` and waits for its post-request tasks.
 */
const storePatient = async (request) => {
    const response = await request
        .post('/4_0_0/Patient/$merge')
        .send(deepcopy(patientResource))
        .set(getHeaders());
    expect(response).toHaveStatusCode(200);
    await waitForPostRequestTasks();
};

/**
 * Sends a PUT of the body to the Patient with the given id, with the given extra headers.
 */
const putPatient = (request, { id, body, headers = {} }) =>
    request.put(`/4_0_0/Patient/${id}`).send(body).set({ ...getHeaders(), ...headers });

/**
 * Sends the PUT so that its write loses: `competitor` runs once, just before the PUT's flush, and
 * then the flush runs. Returns the response and the error the flush threw, if any.
 */
const putLosingTo = async (request, { put, competitor }) => {
    const inserter = getTestContainer().fastDatabaseBulkInserter;
    const originalExecute = inserter.executeAsync.bind(inserter);
    let flushError = null;
    inserter.executeAsync = async (args) => {
        inserter.executeAsync = originalExecute;
        await competitor();
        try {
            return await originalExecute(args);
        } catch (error) {
            flushError = error;
            throw error;
        }
    };
    try {
        const response = await putPatient(request, put);
        return { response, flushError };
    } finally {
        inserter.executeAsync = originalExecute;
    }
};

/**
 * Makes the resource merger write a competing version straight to MongoDB after every merge, so
 * every replay attempt loses. Returns a function that undoes it.
 */
const loseEveryReplayAttempt = (uuid) => {
    const merger = getTestContainer().resourceMerger;
    const originalMerge = merger.fastMergeResourceAsync;
    merger.fastMergeResourceAsync = async (args) => {
        const result = await originalMerge.call(merger, args);
        await writeCompetingVersion(uuid);
        return result;
    };
    return () => {
        merger.fastMergeResourceAsync = originalMerge;
    };
};

describe('PUT on the write pipeline when its write loses a race', () => {
    const originalEnvironment = Object.fromEntries(
        ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    );

    beforeEach(async () => {
        await commonBeforeEach();
        process.env.WRITE_PIPELINE_OPERATIONS = 'update';
    });

    afterEach(async () => {
        for (const key of ENVIRONMENT_KEYS) {
            if (originalEnvironment[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnvironment[key];
            }
        }
        await commonAfterEach();
    });

    test('twoConcurrentPutsBothLand', async () => {
        const request = await createTestRequest();
        await storePatient(request);
        let competing = null;

        const { response } = await putLosingTo(request, {
            put: { id: patientResource.id, body: callerBody(patientResource.id) },
            competitor: async () => {
                competing = await putPatient(request, {
                    id: patientResource.id,
                    body: competitorBody(patientResource.id)
                });
            }
        });

        expect(competing).toHaveStatusCode(200);
        expect(response).toHaveStatusCode(200);
        expect(response.body.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        const stored = await readStored(PATIENT_UUID);
        expect(stored.meta.versionId).toStrictEqual('3');
        expect(stored.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        expect(stored.gender).toBeUndefined();
        expect(await readHistoryVersions(PATIENT_UUID, 3)).toStrictEqual(['1', '2', '3']);
    });

    test('identicalConcurrentPutIsNoOp', async () => {
        const request = await createTestRequest();
        await storePatient(request);
        let competing = null;

        const { response } = await putLosingTo(request, {
            put: { id: patientResource.id, body: callerBody(patientResource.id) },
            competitor: async () => {
                competing = await putPatient(request, {
                    id: patientResource.id,
                    body: callerBody(patientResource.id)
                });
            }
        });

        expect(competing).toHaveStatusCode(200);
        expect(response).toHaveStatusCode(200);
        expect(response.body.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        expect(response.body.meta.versionId).toStrictEqual('2');
        const stored = await readStored(PATIENT_UUID);
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        expect(stored.gender).toBeUndefined();
        expect(await readHistoryVersions(PATIENT_UUID, 2)).toStrictEqual(['1', '2']);
    });

    test('ifMatchLosesToConcurrentWrite', async () => {
        const request = await createTestRequest();
        await storePatient(request);

        const { response } = await putLosingTo(request, {
            put: {
                id: patientResource.id,
                body: callerBody(patientResource.id),
                headers: { 'If-Match': 'W/"1"' }
            },
            competitor: async () => await writeCompetingVersion(PATIENT_UUID, { gender: 'female' })
        });

        expect(response).toHaveStatusCode(412);
        expect(response.body.issue[0].code).toStrictEqual('precondition-failed');
        expect(response.body.issue[0].details.text).toStrictEqual(
            'Version conflict: If-Match does not match current resource version. Older version: 2, If-Match: 1'
        );
        const stored = await readStored(PATIENT_UUID);
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.gender).toStrictEqual('female');
        expect(stored.name).toStrictEqual(patientResource.name);
    });

    test('ifMatchStarAgainstConcurrentDelete', async () => {
        const request = await createTestRequest();
        await storePatient(request);

        const { response } = await putLosingTo(request, {
            put: {
                id: patientResource.id,
                body: callerBody(patientResource.id),
                headers: { 'If-Match': '*' }
            },
            competitor: async () => await (await patientCollection()).deleteOne({ _uuid: PATIENT_UUID })
        });

        expect(response).toHaveStatusCode(412);
        expect(response.body.issue[0].code).toStrictEqual('precondition-failed');
        expect(response.body.issue[0].details.text).toStrictEqual(
            'Version conflict: Resource no longer exists, but If-Match header was provided. If-Match: *'
        );
        await waitForPostRequestTasks();
        expect(await readStored(PATIENT_UUID)).toBeNull();
    });

    test('ifNoneMatchStarLosesCreateRace', async () => {
        const request = await createTestRequest();
        let competing = null;
        let winner = null;

        const { response } = await putLosingTo(request, {
            put: {
                id: CREATED_ID,
                body: callerBody(CREATED_ID),
                headers: { 'If-None-Match': '*' }
            },
            competitor: async () => {
                competing = await putPatient(request, {
                    id: CREATED_ID,
                    body: competitorBody(CREATED_ID)
                });
                winner = await readStored(CREATED_UUID);
            }
        });

        expect(competing).toHaveStatusCode(201);
        expect(response).toHaveStatusCode(412);
        expect(response.body.issue[0].code).toStrictEqual('precondition-failed');
        expect(response.body.issue[0].details.text).toStrictEqual(
            'Version conflict: If-None-Match: * was provided but resource already exists.'
        );
        expect(winner.meta.versionId).toStrictEqual('1');
        expect(await readStored(CREATED_UUID)).toStrictEqual(winner);
    });

    test('lostCreateReplaysAsReplace', async () => {
        const request = await createTestRequest();
        let competing = null;
        let winner = null;

        const { response } = await putLosingTo(request, {
            put: { id: CREATED_ID, body: callerBody(CREATED_ID) },
            competitor: async () => {
                competing = await putPatient(request, {
                    id: CREATED_ID,
                    body: competitorBody(CREATED_ID)
                });
                winner = await readStored(CREATED_UUID);
            }
        });

        expect(competing).toHaveStatusCode(201);
        expect(response).toHaveStatusCode(201);
        expect(response.body.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        const stored = await readStored(CREATED_UUID);
        expect(stored._id).toStrictEqual(winner._id);
        expect(stored.id).toStrictEqual(winner.id);
        expect(stored._sourceAssigningAuthority).toStrictEqual(winner._sourceAssigningAuthority);
        expect(stored.meta.source).toStrictEqual(winner.meta.source);
        expect(stored.meta.security).toStrictEqual(winner.meta.security);
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        expect(stored.gender).toBeUndefined();
    });

    test('retriesRunOut', async () => {
        process.env.REPLACE_RETRIES = '1';
        const request = await createTestRequest();
        await storePatient(request);
        let restoreMerger = () => {};

        try {
            const { response, flushError } = await putLosingTo(request, {
                put: { id: patientResource.id, body: callerBody(patientResource.id) },
                competitor: async () => {
                    await writeCompetingVersion(PATIENT_UUID, { gender: 'female' });
                    restoreMerger = loseEveryReplayAttempt(PATIENT_UUID);
                }
            });
            restoreMerger();

            expect(response).toHaveStatusCode(500);
            expect(flushError.message).toStrictEqual(
                `Unable to save resource Patient/${PATIENT_UUID} with version 4 (original=3) after 10 tries.`
            );
            const stored = await readStored(PATIENT_UUID);
            expect(stored.meta.versionId).toStrictEqual('4');
            expect(stored.gender).toStrictEqual('female');
            expect(stored.name).toStrictEqual(patientResource.name);
        } finally {
            restoreMerger();
        }
    });

    test('lostUpdateWithConcurrencyHandlingOff', async () => {
        process.env.SKIP_HANDLE_CONCURRENCY = 'true';
        const request = await createTestRequest();
        await storePatient(request);

        const { response } = await putLosingTo(request, {
            put: { id: patientResource.id, body: callerBody(patientResource.id) },
            competitor: async () => await writeCompetingVersion(PATIENT_UUID, { gender: 'female' })
        });

        expect(response).toHaveStatusCode(200);
        expect(response.body.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        const stored = await readStored(PATIENT_UUID);
        expect(stored.name).toStrictEqual(response.body.name);
        expect(stored.gender).toBeUndefined();
    });

    test('ifMatchLostUpdateWithConcurrencyHandlingOff', async () => {
        process.env.SKIP_HANDLE_CONCURRENCY = 'true';
        const request = await createTestRequest();
        await storePatient(request);

        const { response } = await putLosingTo(request, {
            put: {
                id: patientResource.id,
                body: callerBody(patientResource.id),
                headers: { 'If-Match': 'W/"1"' }
            },
            competitor: async () => await writeCompetingVersion(PATIENT_UUID, { gender: 'female' })
        });

        const stored = await readStored(PATIENT_UUID);
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.gender).toStrictEqual('female');
        expect(stored.name).toStrictEqual(patientResource.name);
        expect(response).toHaveStatusCode(200);
        expect(response.body.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
        expect(await readHistoryVersions(PATIENT_UUID, 2)).toStrictEqual(['1', '2']);
        const db = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
        const historyVersion2 = await db
            .collection('Patient_4_0_0_History')
            .findOne({ 'resource._uuid': PATIENT_UUID, 'resource.meta.versionId': '2' });
        expect(historyVersion2.resource.name).toStrictEqual([{ family: 'Caller', given: ['Gamma'] }]);
    });
});
