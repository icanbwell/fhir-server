process.env.ENABLE_REMOVE_FAST_SERIALIZER = '0';

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const storedPatientWithEmpties = (uuid) => ({
    resourceType: 'Patient',
    id: uuid,
    meta: {
        versionId: '1',
        lastUpdated: new Date('2026-01-01T00:00:00.000Z'),
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
        ]
    },
    text: {},
    gender: 'male',
    _uuid: uuid,
    _sourceId: uuid,
    _access: { client: 1 },
    _sourceAssigningAuthority: 'client'
});

describe('Remove with fast serializer disabled', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('fast serializer is disabled', async () => {
        await createTestRequest();
        expect(getTestContainer().removeHelper.useFastSerializer).toStrictEqual(false);
    });

    test('empty objects in the stored doc are kept in DELETE history', async () => {
        const request = await createTestRequest();
        const uuid = '9b2f2d3e-1c1b-5b6a-9e8f-000000000003';
        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        await db.collection('Patient_4_0_0').insertOne(storedPatientWithEmpties(uuid));

        await request.delete(`/4_0_0/Patient/${uuid}`).set(getHeaders()).expect(204);
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId, timeoutInSeconds: 20 });

        const historyDb = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
        const history = await historyDb
            .collection('Patient_4_0_0_History')
            .find({ 'request.method': 'DELETE', 'resource._uuid': uuid })
            .toArray();
        expect(history).toHaveLength(1);
        expect(history[0].resource.text).toStrictEqual({});
        expect(history[0].resource.gender).toStrictEqual('male');
    });
});
