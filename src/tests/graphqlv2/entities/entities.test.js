const allergyIntoleranceBundleResource = require('./fixtures/allergy_intolerances.json');
const careTeamBundleResource = require('./fixtures/care_team.json');
const patientBundleResource = require('./fixtures/patients.json');

const expectedEntitiesResponse = require('./fixtures/expected_entities_response.json');

const fs = require('fs');
const path = require('path');

const entitiesQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('GraphQL entities Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GraphQL Patient properly', async () => {
        const request = await createTestRequest();
        const entitiesQueryText = entitiesQuery.replace(/\\n/g, '');

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
                            id: '7d968f42-c0d9-48ff-8b8b-64fd4456280'
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
            .set(getGraphQLHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedEntitiesResponse);
    });
});
