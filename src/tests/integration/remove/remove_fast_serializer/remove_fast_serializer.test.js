const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { generateUUIDv5 } = require('../../../../utils/uid.util');

const securityTags = () => [
    { system: 'https://www.icanbwell.com/access', code: 'client' },
    { system: 'https://www.icanbwell.com/owner', code: 'client' },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
];

const patientPayload = (id) => ({
    resourceType: 'Patient',
    id,
    meta: { source: 'client', security: securityTags() },
    identifier: [{ system: 'http://example.com/mrn', value: `mrn-${id}` }],
    name: [{ family: 'Doe', given: ['Jane'] }],
    gender: 'female'
});

const observationPayload = (id) => ({
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
    meta: { source: 'client', security: securityTags() }
});

/**
 * A Patient written straight to Mongo with empty values, as older data can still hold them.
 * API writes never produce these.
 */
const storedPatientWithEmpties = (uuid) => ({
    resourceType: 'Patient',
    id: uuid,
    meta: {
        versionId: '1',
        lastUpdated: new Date('2026-01-01T00:00:00.000Z'),
        source: 'client',
        security: securityTags()
    },
    identifier: [],
    text: {},
    gender: 'male',
    _uuid: uuid,
    _sourceId: uuid,
    _access: { client: 1 },
    _sourceAssigningAuthority: 'client'
});

describe('Remove with fast serializer', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const mergeResource = async (request, resource) => {
        const resp = await request
            .post(`/4_0_0/${resource.resourceType}/${resource.id}/$merge`)
            .send(resource)
            .set(getHeaders());
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.created).toBe(true);
        // mockHttpContext() gives every request in this test the same requestId, so they share one
        // pending-history map. $merge flushes its history in a post-request task; the DELETE that
        // follows flushes the same map inline. If that task is still in flight, the merge's history
        // entry is written twice (E11000 duplicate _id -> 500). Let the task finish first.
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
    };

    const readDeleteHistory = async (resourceType, filter = {}) => {
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });
        const historyDb = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
        return await historyDb
            .collection(`${resourceType}_4_0_0_History`)
            .find({ 'request.method': 'DELETE', ...filter })
            .toArray();
    };

    test('DELETE by id writes a DELETE history entry', async () => {
        const request = await createTestRequest();
        const startTime = Date.now();
        await mergeResource(request, patientPayload('patient-1'));
        const uuid = generateUUIDv5('patient-1|client');

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const live = await db.collection('Patient_4_0_0').findOne({ _uuid: uuid });
        expect(live).not.toBeNull();

        await request.delete('/4_0_0/Patient/patient-1').set(getHeaders()).expect(204);

        const history = await readDeleteHistory('Patient', { 'resource._uuid': uuid });
        expect(history).toHaveLength(1);
        const [entry] = history;
        expect(entry.id).toStrictEqual(uuid);
        expect(entry.request.method).toStrictEqual('DELETE');
        expect(entry.request.url).toStrictEqual('/4_0_0/Patient/patient-1');
        expect(entry.resource._uuid).toStrictEqual(live._uuid);
        expect(entry.resource._sourceId).toStrictEqual(live._sourceId);
        expect(entry.resource._access).toStrictEqual(live._access);
        expect(entry.resource._sourceAssigningAuthority).toStrictEqual(live._sourceAssigningAuthority);
        expect(entry.resource.meta.security).toStrictEqual(live.meta.security);
        expect(entry.resource.identifier).toStrictEqual(live.identifier);
        expect(entry.resource._id).toBeUndefined();
        expect(entry.resource.meta.lastUpdated).toBeInstanceOf(Date);
        expect(entry.resource.meta.lastUpdated.getTime()).toBeGreaterThanOrEqual(startTime);

        expect(await db.collection('Patient_4_0_0').findOne({ _uuid: uuid })).toBeNull();
    });

    test('GET /_history after DELETE still returns the deleted version', async () => {
        const request = await createTestRequest();
        await mergeResource(request, patientPayload('patient-2'));

        await request.delete('/4_0_0/Patient/patient-2').set(getHeaders()).expect(204);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

        const resp = await request.get('/4_0_0/Patient/patient-2/_history').set(getHeaders()).expect(200);
        const deleteEntries = resp.body.entry.filter((e) => e.request && e.request.method === 'DELETE');
        expect(deleteEntries).toHaveLength(1);
        expect(deleteEntries[0].resource.id).toStrictEqual('patient-2');
        // history read adds the sourceId/uuid identifiers on top of the stored ones
        expect(deleteEntries[0].resource.identifier).toStrictEqual(
            expect.arrayContaining(patientPayload('patient-2').identifier)
        );
        expect(deleteEntries[0].resource._uuid).toBeUndefined();
    });

    test('conditional DELETE (remove_by_query) writes one history entry per matched resource', async () => {
        const request = await createTestRequest();
        await mergeResource(request, observationPayload('obs-1'));
        await mergeResource(request, observationPayload('obs-2'));

        await request
            .delete('/4_0_0/Observation/?code=http://loinc.org|8480-6')
            .set(getHeaders())
            .expect(200);

        const history = await readDeleteHistory('Observation');
        expect(history.map((h) => h.resource.id).sort()).toStrictEqual(['obs-1', 'obs-2']);
        for (const entry of history) {
            expect(entry.id).toStrictEqual(entry.resource._uuid);
            expect(entry.resource.code.coding[0].code).toStrictEqual('8480-6');
        }
    });

    test('empty objects in the stored doc are omitted from DELETE history', async () => {
        const request = await createTestRequest();
        const uuid = '9b2f2d3e-1c1b-5b6a-9e8f-000000000001';
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        await db.collection('Patient_4_0_0').insertOne(storedPatientWithEmpties(uuid));

        await request.delete(`/4_0_0/Patient/${uuid}`).set(getHeaders()).expect(204);

        const history = await readDeleteHistory('Patient', { 'resource._uuid': uuid });
        expect(history).toHaveLength(1);
        expect(history[0].resource.identifier).toBeUndefined();
        expect(history[0].resource.text).toBeUndefined();
        expect(history[0].resource.gender).toStrictEqual('male');
    });

    test('post-save receives the stored plain document, not the serialized snapshot', async () => {
        const request = await createTestRequest();
        const uuid = '9b2f2d3e-1c1b-5b6a-9e8f-000000000002';
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        await db.collection('Patient_4_0_0').insertOne(storedPatientWithEmpties(uuid));
        const afterSaveSpy = jest.spyOn(getTestContainer().postSaveProcessor, 'afterSaveAsync');

        await request.delete(`/4_0_0/Patient/${uuid}`).set(getHeaders()).expect(204);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

        const deleteCalls = afterSaveSpy.mock.calls.filter(([args]) => args.eventType === 'D');
        expect(deleteCalls).toHaveLength(1);
        const { doc } = deleteCalls[0][0];
        expect(doc._uuid).toStrictEqual(uuid);
        // DELETE reads the plain document; the fast serializer drops text: {} only from its copy.
        expect(typeof doc.toJSONInternal).toBe('undefined');
        expect(doc.text).toStrictEqual({});
        afterSaveSpy.mockRestore();
    });
});
