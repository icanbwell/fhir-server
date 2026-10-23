process.env.ENABLE_UPDATE_FAST_SERIALIZER = '0';

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const practitionerPayload = () => ({
    resourceType: 'Practitioner',
    active: true,
    meta: {
        source: 'client',
        security: [
            { system: 'https://www.icanbwell.com/access', code: 'client' },
            { system: 'https://www.icanbwell.com/owner', code: 'client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client' }
        ]
    },
    name: [{ family: 'NAJJAR  MD', given: ['SAMER S.'], use: 'usual' }]
});

describe('Update with fast serializer disabled', () => {
    beforeEach(async () => {
        await commonBeforeEach();
        mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('update uses the existing flow when the flag is disabled', async () => {
        await createTestRequest();
        expect(getTestContainer().updateOperation.useFastSerializer).toStrictEqual(false);
    });

    test('existing flow ignores a client supplied meta.lastUpdated that is not a valid instant', async () => {
        const request = await createTestRequest();
        const postResp = await request.post('/4_0_0/Practitioner').send(practitionerPayload()).set(getHeaders());
        expect(postResp).toHaveStatusCode(201);
        const id = postResp.body.id;

        const payload = practitionerPayload();
        payload.id = id;
        payload.active = false;
        payload.meta.lastUpdated = '2021-06-01';
        const putResp = await request.put(`/4_0_0/Practitioner/${id}`).send(payload).set(getHeaders());
        expect(putResp).toHaveStatusCode(200);
        expect(putResp.body.meta.lastUpdated).not.toStrictEqual('2021-06-01');
        expect(putResp.body.meta.versionId).toStrictEqual('2');
    });

    test('existing flow enforces If-Match atomically when another writer lands between the read and the write', async () => {
        const request = await createTestRequest();
        const container = getTestContainer();
        const postResp = await request.post('/4_0_0/Practitioner').send(practitionerPayload()).set(getHeaders());
        const id = postResp.body.id;
        const db = await container.mongoDatabaseManager.getClientDbAsync();
        const collection = db.collection('Practitioner_4_0_0');

        const inserter = container.databaseBulkInserter;
        const originalExecute = inserter.executeAsync.bind(inserter);
        inserter.executeAsync = async (args) => {
            await collection.updateOne({ _uuid: id }, { $set: { 'meta.versionId': '2', active: false } });
            return await originalExecute(args);
        };
        try {
            const payload = practitionerPayload();
            payload.id = id;
            payload.name = [{ family: 'LOSER', given: ['B'] }];
            const resp = await request
                .put(`/4_0_0/Practitioner/${id}`)
                .send(payload)
                .set({ ...getHeaders(), 'If-Match': 'W/"1"' });
            expect(resp).toHaveStatusCode(412);
        } finally {
            inserter.executeAsync = originalExecute;
        }
        const stored = await collection.findOne({ _uuid: id });
        expect(stored.meta.versionId).toStrictEqual('2');
        expect(stored.name[0].family).not.toStrictEqual('LOSER');
    });
});
