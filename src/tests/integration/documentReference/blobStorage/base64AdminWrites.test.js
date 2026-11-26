'use strict';

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const {
    commonAfterEach, commonBeforeEach, getHeaders, getHeadersWithCustomToken, getTestContainer, mockHttpContext
} = require('../../common');
const {
    ENV_FLAG_OFF, ENV_ON, LARGE_DATA, WRITES,
    attachmentOf, buildDocumentReference, createRequestAsync,
    getLiveObjects, getMongoDocument, restoreEnv, saveEnv, settle
} = require('./blobStorageTestSupport');

const PATIENT_1 = 'admin-patient-1';
const PATIENT_2 = 'admin-patient-2';
const DOC_ID = 'admin-doc';
const META = buildDocumentReference().meta;

const patient = (id) => ({ resourceType: 'Patient', id, meta: META });
const documentReferenceFor = (patientId) => ({
    ...buildDocumentReference({ id: DOC_ID, content: [{ attachment: attachmentOf(LARGE_DATA) }] }),
    subject: { reference: `Patient/${patientId}` }
});
const s3Count = () => Object.keys(getTestContainer().base64FieldCloudStorageClient.uploadedData).length;
const eventually = async (check, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await check();
        if (last) {
            return last;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return last;
};

// Admin writes run one path: no operation named admin consumes WRITE_PIPELINE_OPERATIONS, and the
// admin writer does not use the write pipeline. The merge that prepares the data uses the default.
describe('admin writes of a DocumentReference with an S3 attachment', () => {
    let savedEnv;
    let requestId;

    beforeEach(async () => {
        savedEnv = saveEnv();
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
        restoreEnv(savedEnv);
    });

    const prepare = async () => {
        const request = await createRequestAsync(ENV_ON);
        for (const id of [PATIENT_1, PATIENT_2]) {
            await WRITES.merge(request, patient(id));
        }
        await WRITES.merge(request, documentReferenceFor(PATIENT_1));
        await settle(requestId);
        return request;
    };

    test.each([
        ['flag on', ENV_ON],
        ['flag off', ENV_FLAG_OFF]
    ])('updatePatientReference keeps the sidecar and the S3 object, only the reference changes (%s)', async (_name, env) => {
        let request = await prepare();
        const before = await getMongoDocument(DOC_ID);
        const objectsBefore = s3Count();
        expect(before.content[0].attachment._blobMeta).toBeDefined();
        if (env === ENV_FLAG_OFF) {
            request = await createRequestAsync(env, { carryOverS3: true });
        }

        await request
            .post(`/admin/updatePatientReference?patientId=${PATIENT_2}&resourceType=DocumentReference&resourceId=${DOC_ID}`)
            .send({ patientId: PATIENT_2, resourceType: 'DocumentReference', resourceId: DOC_ID })
            .set(getHeadersWithCustomToken('user/*.* access/*.* admin/*.*'))
            .expect(200);

        const after = await getMongoDocument(DOC_ID);
        expect(after.subject.reference).toBe(`Patient/${PATIENT_2}`);
        expect(after.meta.versionId).toBe('2');
        expect(after.content[0].attachment._blobMeta).toEqual(before.content[0].attachment._blobMeta);
        expect(after.content[0].attachment.data).toBeUndefined();
        expect(after.content[0].attachment._file_id).toBeUndefined();
        expect(s3Count()).toBe(objectsBefore);
        if (env === ENV_ON) {
            const read = await request.get(`/4_0_0/DocumentReference/${DOC_ID}`).set(getHeaders()).expect(200);
            expect(read.body.content[0].attachment.data).toBe(LARGE_DATA);
        }
    });

    test('deletePatientDataGraph removes the live S3 object and keeps the data in the history bucket', async () => {
        const request = await prepare();
        const before = await getMongoDocument(DOC_ID);
        const { _uuid: uuid } = before;
        const { hash } = before.content[0].attachment._blobMeta;
        expect(getLiveObjects(uuid)).toHaveLength(1);

        await request
            .delete(`/admin/deletePatientDataGraph?id=${PATIENT_1}&sync=1`)
            .set(getHeadersWithCustomToken('user/*.* admin/*.*'))
            .expect(200);

        expect(await getMongoDocument(DOC_ID)).toBeNull();
        expect(getLiveObjects(uuid)).toEqual([]);
        const container = getTestContainer();
        const historyKey = `DocumentReference_4_0_0_History/${uuid}/${hash}`;
        expect(container.historyResourceCloudStorageClient.uploadedData[historyKey]).toBe(LARGE_DATA);
        const historyDb = await container.mongoDatabaseManager.getResourceHistoryDbAsync();
        const deleteEntry = await eventually(async () => (
            await historyDb.collection('DocumentReference_4_0_0_History').find({}).toArray()
        ).find((entry) => entry.request && entry.request.method === 'DELETE'));
        expect(deleteEntry).toBeDefined();
        expect(deleteEntry.resource.content[0].attachment.data).toBeUndefined();
        expect(deleteEntry.resource.content[0].attachment._blobMeta.hash).toBe(hash);
    });
});
