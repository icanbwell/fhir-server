const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation1AttackerPut = require('./fixtures/Observation/observation1_attacker_put.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('PUT by UUID cross-tenant tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('update Tests', () => {
        test('PUT by _uuid for a resource in another tenant does not confirm existence or overwrite it (F5)', async () => {
            const request = await createTestRequest();

            // clientA creates its own Observation
            const createResp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            expect(createResp).toHaveMergeResponse({ created: true });
            const clientAUuid = createResp._body.uuid;
            expect(clientAUuid).toBeDefined();

            // clientB, with no scope for clientA at all, PUTs to clientA's exact _uuid
            const attackerResp = await request
                .put('/4_0_0/Observation/' + clientAUuid)
                .send(observation1AttackerPut)
                .set(getHeaders('access/clientB.* user/*.*'));

            // Must not be a 403 (that would confirm the uuid belongs to someone else's tenant)
            expect(attackerResp.status).not.toBe(403);

            // The original clientA resource must be untouched by the attacker's PUT
            const readBackResp = await request
                .get('/4_0_0/Observation/' + clientAUuid)
                .set(getHeaders('access/clientA.* user/*.*'))
                .expect(200);

            expect(readBackResp._body.meta.versionId).toStrictEqual('1');
            expect(readBackResp._body.valueQuantity.value).toStrictEqual(70.00000000000001);
        });

        test('PUT by _uuid within the same tenant still updates the resource', async () => {
            const request = await createTestRequest();

            const createResp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation1Resource)
                .set(getHeaders())
                .expect(200);

            expect(createResp).toHaveMergeResponse({ created: true });
            const clientAUuid = createResp._body.uuid;

            const updatedObservation = {
                ...observation1Resource,
                valueQuantity: { ...observation1Resource.valueQuantity, value: 72.0 }
            };

            await request
                .put('/4_0_0/Observation/' + clientAUuid)
                .send(updatedObservation)
                .set(getHeaders('access/clientA.* user/*.*'))
                .expect(200);

            const readBackResp = await request
                .get('/4_0_0/Observation/' + clientAUuid)
                .set(getHeaders('access/clientA.* user/*.*'))
                .expect(200);

            expect(readBackResp._body.meta.versionId).toStrictEqual('2');
            expect(readBackResp._body.valueQuantity.value).toStrictEqual(72.0);
        });
    });
});
