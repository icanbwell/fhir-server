const patientResource = require('./fixtures/patient_with_gp.json');
const practitionerResource = require('./fixtures/practitioner1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, getGraphQLHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

const mutation = (remove) => `mutation {
    updateGeneralPractitioner(patientId: "1", practitionerId: "p1", remove: ${remove}) {
        id
    }
}`;

describe('GraphQL v1 updateGeneralPractitioner v2 CRUDS scope granularity Tests', () => {
    let originalFlag;

    beforeAll(() => {
        originalFlag = process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '1';
    });

    afterAll(() => {
        if (originalFlag === undefined) {
            delete process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        } else {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = originalFlag;
        }
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test.each([
        [
            'removing needs r, u and d on the patient and r on the practitioner',
            true,
            'user/Patient.rud user/Practitioner.r access/access.rud access/owner.rud',
            true
        ],
        [
            'removing without d on the patient is denied',
            true,
            'user/Patient.ru user/Practitioner.r access/access.ru access/owner.ru',
            false
        ],
        [
            'adding needs r and u on the patient and r on the practitioner',
            false,
            'user/Patient.ru user/Practitioner.r access/access.ru access/owner.ru',
            true
        ],
        [
            'adding without u on the patient is denied',
            false,
            'user/Patient.r user/Practitioner.r access/access.r access/owner.r',
            false
        ]
    ])('%s', async (name, remove, scope, allowed) => {
        const request = await createTestRequest();
        await request.post('/4_0_0/Patient/$merge').send(patientResource).set(getHeaders()).expect(200);
        await request.post('/4_0_0/Practitioner/$merge').send(practitionerResource).set(getHeaders()).expect(200);

        const resp = await request
            .post('/$graphql')
            .send({ operationName: null, variables: {}, query: mutation(remove) })
            .set(getGraphQLHeaders(scope));

        if (allowed) {
            expect(resp.body.errors).toBeUndefined();
            expect(resp.body.data.updateGeneralPractitioner.id).toBe('1');
        } else {
            expect(resp.body.errors).toBeDefined();
        }
    });
});
