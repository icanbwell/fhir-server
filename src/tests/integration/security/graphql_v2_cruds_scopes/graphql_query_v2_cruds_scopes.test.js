const patientResource = require('./fixtures/patient_with_gp.json');

const { commonBeforeEach, commonAfterEach, getHeaders, getGraphQLHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

const queries = {
    '/$graphql': {
        byId: '{ patient(id: "1") { entry { resource { id } } } }',
        byGender: '{ patient(gender: {value: {code: "male"}}) { entry { resource { id } } } }',
        entries: (body) => body.data?.patient?.entry ?? []
    },
    '/4_0_0/$graphqlv2': {
        byId: '{ patients(id: {value: "1"}) { entry { resource { id } } } }',
        byGender: '{ patients(gender: {value: {code: "male"}}) { entry { resource { id } } } }',
        entries: (body) => body.data?.patients?.entry ?? []
    }
};

describe('GraphQL v1 and v2 query v2 CRUDS scope granularity Tests', () => {
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

    describe.each(Object.keys(queries))('%s', (url) => {
        test.each([
            ['a lookup by id with r on both gates returns the patient', 'byId', 'user/Patient.r access/access.r access/owner.r', 1],
            ['a lookup by id with s alone returns nothing', 'byId', 'user/Patient.s access/access.s access/owner.s', 0],
            ['a search by another parameter with s on both gates returns the patient', 'byGender', 'user/Patient.s access/access.s access/owner.s', 1],
            ['a search by another parameter with r alone returns nothing', 'byGender', 'user/Patient.r access/access.r access/owner.r', 0],
            ['a lookup by id for another tenant returns nothing', 'byId', 'user/Patient.r access/other.r', 0],
            ['a search by another parameter for another tenant returns nothing', 'byGender', 'user/Patient.s access/other.s', 0]
        ])('%s', async (name, queryName, scope, expectedCount) => {
            const request = await createTestRequest();
            await request.post('/4_0_0/Patient/$merge').send(patientResource).set(getHeaders()).expect(200);

            const resp = await request
                .post(url)
                .send({ operationName: null, variables: {}, query: queries[url][queryName] })
                .set(getGraphQLHeaders(scope));

            expect(queries[url].entries(resp.body).length).toBe(expectedCount);
        });
    });
});
