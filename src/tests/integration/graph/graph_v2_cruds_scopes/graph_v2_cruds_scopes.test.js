const personResource = require('./fixtures/Person/person.json');
const patientResource = require('./fixtures/Patient/patient.json');
const observationResource = require('./fixtures/Observation/observation.json');
const graphDefinition = require('./fixtures/graph/graph_person_to_patient_to_observation.json');

const expectedResponses = {
    expected_read_all: require('./fixtures/expected/expected_read_all.json'),
    expected_delete_rs_denied: require('./fixtures/expected/expected_delete_rs_denied.json'),
    expected_delete_resource_gate_denied: require('./fixtures/expected/expected_delete_resource_gate_denied.json'),
    expected_delete_access_gate_denied: require('./fixtures/expected/expected_delete_access_gate_denied.json'),
    expected_delete_d_only: require('./fixtures/expected/expected_delete_d_only.json'),
    expected_delete_ds: require('./fixtures/expected/expected_delete_ds.json'),
    expected_delete_rds: require('./fixtures/expected/expected_delete_rds.json')
};

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('$graph v2 CRUDS scope granularity Tests', () => {
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

    const arrangeAsync = async (request) => {
        for (const [resourceType, resource] of [
            ['Patient', patientResource],
            ['Observation', observationResource],
            ['Person', personResource]
        ]) {
            const resp = await request
                .post(`/4_0_0/${resourceType}/1/$merge?validate=true`)
                .send(resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        }
    };

    const remainingAsync = async (request) => {
        const remaining = [];
        for (const path of ['Person/person-1', 'Patient/patient-1', 'Observation/observation-1']) {
            const resp = await request
                .get(`/4_0_0/${path}`)
                .set(getHeaders('user/*.read access/client-p1.read'));
            if (resp.status === 200) {
                remaining.push(path);
            }
        }
        return remaining;
    };

    const deleteGraphAsync = (request, scope) =>
        request
            .delete('/4_0_0/Person/person-1/$graph')
            .set(getHeaders(scope))
            .send(graphDefinition);

    const cases = [
        ['GET with rs grant on both gates returns the whole graph', 'get', 'user/*.rs access/client-p1.rs', 'expected_read_all', 3],
        ['DELETE with rs grant is denied and deletes nothing', 'delete', 'user/*.rs access/client-p1.rs', 'expected_delete_rs_denied', 3],
        ['DELETE with d on the access gate only is denied and deletes nothing', 'delete', 'user/*.rs access/client-p1.d', 'expected_delete_resource_gate_denied', 3],
        ['DELETE with d on the resource gate only is denied and deletes nothing', 'delete', 'user/*.d access/client-p1.rs', 'expected_delete_access_gate_denied', 3],
        ['DELETE with d-only grant deletes the root and forward-linked children but not reverse-linked children', 'delete', 'user/*.d access/client-p1.d', 'expected_delete_d_only', 1],
        ['DELETE with d and s grant deletes the whole graph', 'delete', 'user/*.ds access/client-p1.ds', 'expected_delete_ds', 0],
        ['DELETE with rds grant on both gates deletes the whole graph', 'delete', 'user/*.rds access/client-p1.rds', 'expected_delete_rds', 0]
    ];

    test.each(cases)('%s', async (name, method, scope, expectedName, remainingCount) => {
        const request = await createTestRequest();
        await arrangeAsync(request);
        const resp = method === 'get'
            ? await request.post('/4_0_0/Person/person-1/$graph').set(getHeaders(scope)).send(graphDefinition)
            : await deleteGraphAsync(request, scope);
        expect(resp).toHaveResponse(expectedResponses[expectedName]);
        expect(await remainingAsync(request)).toHaveLength(remainingCount);
    });
});
