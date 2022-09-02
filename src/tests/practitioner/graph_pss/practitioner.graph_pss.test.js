// practice
const groupResource = require('./fixtures/practitioner/group.json');
const insurancePlanResource = require('./fixtures/practitioner/insurancePlan.json');
const locationResource = require('./fixtures/practitioner/location.json');
const organizationResource = require('./fixtures/practitioner/organization.json');
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerRoleResource = require('./fixtures/practitioner/practitionerRole.json');
const scheduleResource = require('./fixtures/practitioner/schedule.json');
const healthcareServiceResource = require('./fixtures/practitioner/healthcareService.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');

// expected
const expectedResource = require('./fixtures/expected/expected.json');
const expectedHashReferencesResource = require('./fixtures/expected/expected_hash_references.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

const {expectMergeResponse} = require('../../fhirAsserts');

describe('Practitioner Graph PSS Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph Contained PSS Tests', () => {
        test('Graph contained PSS works properly', async () => {
            const request = await createTestRequest();
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Group/1/$merge')
                .send(groupResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: {created: true}});

            resp = await request
                .post('/4_0_0/InsurancePlan/1/$merge')
                .send(insurancePlanResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: [{created: true}, {created: true}]});

            resp = await request
                .post('/4_0_0/Location/1/$merge')
                .send(locationResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: {created: true}});

            resp = await request
                .post('/4_0_0/Practitioner/1003059437/$merge')
                .send(practitionerResource)
                .set(getHeaders())
                .expect(200);

            expectMergeResponse({resp, checks: [{created: true}, {created: true}]});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: [{created: true}, {created: true}]});

            resp = await request
                .post('/4_0_0/Schedule/1/$merge')
                .send(scheduleResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: [{created: true}]});

            resp = await request
                .post('/4_0_0/Organization/123456/$merge')
                .send(organizationResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: [{created: true}, {created: true}]});

            resp = await request
                .post('/4_0_0/HealthcareService/123456/$merge')
                .send(healthcareServiceResource)
                .set(getHeaders())
                .expect(200);
            expectMergeResponse({resp, checks: [{created: true}, {created: true}]});

            resp = await request
                .post('/4_0_0/Practitioner/$graph?id=1003059437&contained=true')
                .send(graphDefinitionResource)
                .set(getHeaders());
            expect(resp).toHaveResponse(expectedResource);

            resp = await request
                .post(
                    '/4_0_0/Practitioner/$graph?id=1003059437&contained=true&_hash_references=true'
                )
                .send(graphDefinitionResource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedHashReferencesResource);
            expect(resp).toBeArray('kk');
        });
    });
});
