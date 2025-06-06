const allergyIntoleranceBundleResource = require('./fixtures/allergy_intolerances.json');
const careTeamBundleResource = require('./fixtures/care_team.json');
const patientBundleResource = require('./fixtures/patients.json');
const personResource = require('./fixtures/person.json');
const consentResource = require('./fixtures/consent.json');

const expectedEntitiesResponse = require('./fixtures/expected_entities_response.json');
const expectedEntitiesResponseWithPatientScope = require('./fixtures/expected_entities_response_with_patient_scope.json');
const expectedEntitiesResponseWithViewControl = require('./fixtures/expected_entities_response_with_view_control.json');
const expectedEntitiesResponseWithoutGlobalId = require('./fixtures/expected_entities_response_without_globalid.json');

const fs = require('fs');
const path = require('path');

const entitiesQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
    getCustomGraphQLHeaders
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL entities Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GraphQL entities with default global_id properly', async () => {
        const request = await createTestRequest();
        const entitiesQueryText = entitiesQuery.replace(/\\n/g, '');

        let resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patientBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request
            .post('/4_0_0/AllergyIntolerance/1/$merge')
            .send(allergyIntoleranceBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request
            .post('/4_0_0/CareTeam/1/$merge')
            .send(careTeamBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {
                    representations: [
                        // expected results
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'AllergyIntolerance/0af7ad3f-9f37-1a62-09e4-4ca127531c51'
                        },
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'e039c680-1024-34ff-d9d8-5d87feada4d5'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'CareTeam/68ea6705-c595-445b-9782-a54accfc5d06'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'af56a61a-34e6-5a7f-9539-cdc82c000f6f'
                        },
                        {
                            __typename: 'Patient',
                            id: 'Patient/WPS-5458231534'
                        },
                        {
                            __typename: 'Patient',
                            id: '88d5028b-42d5-569b-8b3c-beb24c00c6c4'
                        },
                        // invalid ids
                        {
                            __typename: 'Patient',
                            id: 'invald-id'
                        },
                        {
                            __typename: 'Patient',
                            id: 'Person/mismatched-reference'
                        }
                    ]
                },
                query: entitiesQueryText
            })
            .set(getGraphQLHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedEntitiesResponse);
    });

    test('GraphQL entities with global_id=false properly', async () => {
        const request = await createTestRequest();
        const entitiesQueryText = entitiesQuery.replace(/\\n/g, '');

        let resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patientBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request
            .post('/4_0_0/AllergyIntolerance/1/$merge')
            .send(allergyIntoleranceBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request
            .post('/4_0_0/CareTeam/1/$merge')
            .send(careTeamBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {
                    representations: [
                        // expected results
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'AllergyIntolerance/0af7ad3f-9f37-1a62-09e4-4ca127531c51'
                        },
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'e039c680-1024-34ff-d9d8-5d87feada4d5'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'CareTeam/68ea6705-c595-445b-9782-a54accfc5d06'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'af56a61a-34e6-5a7f-9539-cdc82c000f6f'
                        },
                        {
                            __typename: 'Patient',
                            id: 'Patient/WPS-0559166162'
                        },
                        {
                            __typename: 'Patient',
                            id: 'WPS-5458231534'
                        },
                        // invalid ids
                        {
                            __typename: 'Patient',
                            id: 'invald-id'
                        },
                        {
                            __typename: 'Patient',
                            id: 'Person/mismatched-reference'
                        }
                    ]
                },
                query: entitiesQueryText
            })
            .set({
                ...getGraphQLHeaders(),
                prefer: 'global_id=false'
            });
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedEntitiesResponseWithoutGlobalId);
    });

    test('GraphQL entities with patient scope and view control', async () => {
        const CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = 'client';

        const request = await createTestRequest();
        const entitiesQueryText = entitiesQuery.replace(/\\n/g, '');

        let resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(personResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patientBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);


        resp = await request
            .post('/4_0_0/AllergyIntolerance/1/$merge')
            .send(allergyIntoleranceBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        resp = await request
            .post('/4_0_0/CareTeam/1/$merge')
            .send(careTeamBundleResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        const patient_scope = {
            scope: 'access/*.* patient/*.* user/*.*',
            username: 'patient-123@example.com',
            clientFhirPersonId: 'f0f35c4e-22a2-549d-88e9-50263c4da925',
            clientFhirPatientId: 'b4fa6c01-9fb5-5ef7-83e2-071e32a28ca1',
            bwellFhirPersonId: 'person1',
            bwellFhirPatientId: 'patient1',
            token_use: 'access'
        };

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {
                    representations: [
                        // expected results
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'AllergyIntolerance/0af7ad3f-9f37-1a62-09e4-4ca127531c51'
                        },
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'e039c680-1024-34ff-d9d8-5d87feada4d5'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'CareTeam/68ea6705-c595-445b-9782-a54accfc5d06'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'af56a61a-34e6-5a7f-9539-cdc82c000f6f'
                        },
                        {
                            __typename: 'Patient',
                            id: 'Patient/WPS-5458231534'
                        },
                        {
                            __typename: 'Patient',
                            id: '88d5028b-42d5-569b-8b3c-beb24c00c6c4'
                        }
                    ]
                },
                query: entitiesQueryText
            })
            .set(getCustomGraphQLHeaders(patient_scope));
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedEntitiesResponseWithPatientScope);


        // Create View Control Consent
        resp = await request.post('/4_0_0/Consent/1/$merge').send(consentResource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {
                    representations: [
                        // expected results
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'AllergyIntolerance/0af7ad3f-9f37-1a62-09e4-4ca127531c51'
                        },
                        {
                            __typename: 'AllergyIntolerance',
                            id: 'e039c680-1024-34ff-d9d8-5d87feada4d5'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'CareTeam/68ea6705-c595-445b-9782-a54accfc5d06'
                        },
                        {
                            __typename: 'CareTeam',
                            id: 'af56a61a-34e6-5a7f-9539-cdc82c000f6f'
                        },
                        {
                            __typename: 'Patient',
                            id: 'Patient/WPS-5458231534'
                        },
                        {
                            __typename: 'Patient',
                            id: '88d5028b-42d5-569b-8b3c-beb24c00c6c4'
                        }
                    ]
                },
                query: entitiesQueryText
            })
            .set(getCustomGraphQLHeaders(patient_scope));
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedEntitiesResponseWithViewControl);

        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
    });
});
