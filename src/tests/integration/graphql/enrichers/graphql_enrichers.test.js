const fs = require('fs');
const path = require('path');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getGraphQLHeaders } = require('../../common');

// test file
const person1Resource = require('./fixtures/Person/person1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const composition1Resource = require('./fixtures/Composition/composition1.json');

// graphql query
const enrichersGraphQLQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

// expected
const expectedEnrichedResponse = require('./fixtures/expected/expected.json');

describe('Enrichers test for graphql', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Golbalid and proxy patient enrichers works', async () => {
        const request = await createTestRequest();
        const graphqlQueryText = enrichersGraphQLQuery.replace(/\\n/g, '');
        // ARRANGE
        // add the resources to FHIR server
        let resp = await request.post('/4_0_0/Person/1/$merge?validate=true').send(person1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // add patients
        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(patient1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // add tasks
        resp = await request
            .post('/4_0_0/Composition/1/$merge?validate=true')
            .send(composition1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // ACT & ASSERT
        resp = await request
            .post('/$graphql')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set({
                ...getGraphQLHeaders(),
                prefer: 'global_id=true'
            });

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedEnrichedResponse);
    });
});
