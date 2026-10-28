const patient1Resource = require('./fixtures/patient1.json');
const condition1Resource = require('./fixtures/condition1.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeAll, afterAll, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('$summary v2 CRUDS scope granularity Tests', () => {
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
        ['r on the Patient alone returns no Condition', 'user/Patient.r access/access.r access/owner.r', false],
        ['r on the Condition returns no Condition', 'user/Patient.r user/Condition.r access/access.r access/owner.r', false],
        ['s on the Condition with r on the access gate returns no Condition', 'user/Patient.r user/Condition.s access/access.r access/owner.r', false],
        ['s on the Condition on both gates returns the Condition', 'user/Patient.r user/Condition.s access/access.rs access/owner.rs', true],
        ['v1 read scopes return the Condition', 'user/Patient.read user/Condition.read access/access.read access/owner.read', true]
    ])('%s', async (name, scope, expectConditionReturned) => {
        const request = await createTestRequest();
        const patientMerge = await request
            .post('/4_0_0/Patient/$merge')
            .send(patient1Resource)
            .set(getHeaders());
        expect(patientMerge).toHaveMergeResponse({ created: true });
        const conditionMerge = await request
            .post('/4_0_0/Condition/$merge')
            .send(condition1Resource)
            .set(getHeaders());
        expect(conditionMerge).toHaveMergeResponse({ created: true });

        const resp = await request.get('/4_0_0/Patient/1/$summary').set(getHeaders(scope));
        expect(resp.status).toBe(200);
        const resourceTypes = resp.body.entry.map((e) => e.resource.resourceType);
        expect(resourceTypes).toContain('Patient');
        expect(resourceTypes.includes('Condition')).toBe(expectConditionReturned);
    });
});
