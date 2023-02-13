// practice
const practitionerResource = require('./fixtures/practitioner/practitioner.json');
const practitionerRoleResource = require('./fixtures/practitioner/practitionerRole.json');
const practitionerRoleDifferentSecurityTagResource = require('./fixtures/practitioner/practitionerRoleDifferentSecurityTag.json');
const organizationResource = require('./fixtures/practitioner/organization.json');

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

const {findDuplicateResources} = require('../../../utils/list.util');
const {describe, beforeEach, afterEach, expect, test } = require('@jest/globals');
const {logInfo} = require('../../../operations/common/logging');

describe('Practitioner Graph Contained Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Graph Contained Tests', () => {
        test('Graph contained works properly', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleDifferentSecurityTagResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/123456/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/$graph?id=1679033641&contained=true')
                .send(graphDefinitionResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);

            resp = await request
                .post(
                    '/4_0_0/Practitioner/$graph?id=1679033641&contained=true&_hash_references=true'
                )
                .send(graphDefinitionResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedHashReferencesResource);

            logInfo('----- Received resources ----');
            logInfo(
                `${resp.body.entry.map((e) => e.resource).map((a) => `${a.resourceType}/${a.id}`)}`
            );
            logInfo('----- End of Received resources ----');
            // verify there are no duplicate ids
            const duplicates = findDuplicateResources(resp.body.entry.map((e) => e.resource));
            expect(duplicates.map((a) => `${a.resourceType}/${a.id}`)).toStrictEqual([]);
        });
        test('Graph contained works properly with parameters', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/1679033641/$merge')
                .send(practitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/PractitionerRole/1/$merge')
                .send(practitionerRoleDifferentSecurityTagResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Organization/123456/$merge')
                .send(organizationResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            /**
             * http://www.hl7.org/fhir/parameters-example.json.html
             * @type {{parameter: [{resource: {resourceType: string, id: string, meta: {security: {}}, identifier: {}, active: boolean, name: {}, telecom: {}, address: {}, gender: string}, name: string}], resourceType: string}}
             */
            const parametersResource = {
                resourceType: 'Parameters',
                parameter: [{name: 'resource', resource: graphDefinitionResource}],
            };

            resp = await request
                .post('/4_0_0/Practitioner/$graph?id=1679033641&contained=true')
                .send(parametersResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);

            resp = await request
                .post(
                    '/4_0_0/Practitioner/$graph?id=1679033641&contained=true&_hash_references=true'
                )
                .send(parametersResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedHashReferencesResource);

            logInfo('----- Received resources ----');
            logInfo(
                `${resp.body.entry.map((e) => e.resource).map((a) => `${a.resourceType}/${a.id}`)}`
            );
            logInfo('----- End of Received resources ----');
            // verify there are no duplicate ids
            const duplicates = findDuplicateResources(resp.body.entry.map((e) => e.resource));
            expect(duplicates.map((a) => `${a.resourceType}/${a.id}`)).toStrictEqual([]);
        });
    });
});
