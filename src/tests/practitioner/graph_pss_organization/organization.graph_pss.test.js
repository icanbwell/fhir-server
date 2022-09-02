// practice
const locationResource = require('./fixtures/practitioner/location.json');
const organizationResource = require('./fixtures/practitioner/organization.json');
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
const {describe, beforeEach, afterEach} = require('@jest/globals');

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
            let resp = await request.get('/4_0_0/Practitioner').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Location/1/$merge')
                .send(locationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Schedule/1/$merge')
                .send(scheduleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/123456/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

            resp = await request
                .post('/4_0_0/HealthcareService/123456/$merge')
                .send(healthcareServiceResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

            resp = await request
                .post('/4_0_0/Organization/$graph?contained=true&id=Medstar-Alias-MPF-MPCR')
                .send(graphDefinitionResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);

            resp = await request
                .post(
                    '/4_0_0/Organization/$graph?contained=true&id=Medstar-Alias-MPF-MPCR&_hash_references=true'
                )
                .send(graphDefinitionResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedHashReferencesResource);
        });
    });
});
