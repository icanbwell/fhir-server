// GraphQL requests that resolve no single resource type (federation _entities calls, validation
// errors) never set req.resourceType, so they used to be dropped from the access log.
const fs = require('fs');
const path = require('path');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    getJsonHeadersWithAdminToken,
    createTestRequest,
    getTestContainer
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AccessLogger } = require('../../../utils/accessLogger');

const fixtures = path.resolve(__dirname, '../graphqlv2/allergyIntolerance/fixtures');
const patients = require(`${fixtures}/patients.json`);
const allergies = require(`${fixtures}/allergy_intolerances.json`);
const searchQuery = fs.readFileSync(`${fixtures}/query.graphql`, 'utf8').replace(/\\n/g, '');
const entitiesQuery =
    'query($representations: [_Any!]!) { _entities(representations: $representations) { ... on AllergyIntolerance { id } } }';
const allergyId = '0af7ad3f-9f37-1a62-09e4-4ca127531c51';

describe('AccessLogs GraphQL Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test.each([
        ['v2 search', '/4_0_0/$graphqlv2', { query: searchQuery, variables: {} }, 'AllergyIntolerance', 'READ'],
        [
            'v2 _entities',
            '/4_0_0/$graphqlv2',
            {
                query: entitiesQuery,
                variables: { representations: [{ __typename: 'AllergyIntolerance', id: allergyId }] }
            },
            '$graphqlv2',
            'READ'
        ],
        ['v2 validation error', '/4_0_0/$graphqlv2', { query: '{ nope }', variables: {} }, '$graphqlv2', 'READ'],
        [
            'v2 mutation',
            '/4_0_0/$graphqlv2',
            { query: 'mutation { nope }', variables: {} },
            '$graphqlv2',
            'WRITE'
        ],
        [
            'v2 _entities on a sub-path',
            '/4_0_0/$graphqlv2/Patient',
            {
                query: entitiesQuery,
                variables: { representations: [{ __typename: 'AllergyIntolerance', id: allergyId }] }
            },
            '$graphqlv2',
            'READ'
        ]
    ])('%s is written to the access log', async (name, url, body, expectedResourceType, expectedOperation) => {
        const request = await createTestRequest((container) => {
            container.register(
                'accessLogger',
                (c) =>
                    new AccessLogger({
                        fhirOperationsManager: c.fhirOperationsManager,
                        configManager: c.configManager,
                        databaseBulkInserter: c.fastDatabaseBulkInserter
                    })
            );
            return container;
        });
        const accessLogger = (await getTestContainer()).accessLogger;
        await request.post('/4_0_0/Patient/1/$merge').send(patients).set(getHeaders());
        await request.post('/4_0_0/AllergyIntolerance/1/$merge').send(allergies).set(getHeaders());

        const requestId = `graphql-access-log-${name.replace(/[^a-zA-Z0-9]+/g, '-')}`;
        await request
            .post(url)
            .send(body)
            .set({ ...getGraphQLHeaders(), 'x-request-id': requestId });
        await accessLogger.flushAsync();

        const logs = await request
            .get(`/admin/searchLogResults?id=${requestId}`)
            .set(getJsonHeadersWithAdminToken());
        expect(logs.statusCode).toBe(200);
        expect(logs.body).toHaveLength(1);
        expect(logs.body[0].request.resourceType).toBe(expectedResourceType);
        expect(logs.body[0].request.operation).toBe(expectedOperation);
        expect(logs.body[0].details.body).toBeDefined();
    });
});
