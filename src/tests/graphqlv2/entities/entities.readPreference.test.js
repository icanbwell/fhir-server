const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { ReadPreference } = require('mongodb');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');

const patientBundleResource = require('./fixtures/patients.json');

const fs = require('fs');
const path = require('path');

const entitiesQuery = fs.readFileSync(path.resolve(__dirname, './fixtures/query.graphql'), 'utf8');

describe('GraphQL entities readPreference Tests', () => {
    let originalFind;
    let mockFind;

    beforeEach(async () => {
        await commonBeforeEach();

        // Mock the MongoDB find method to capture readPreference
        const { MongoClient } = require('mongodb');
        const Collection = require('mongodb').Collection;

        originalFind = Collection.prototype.find;
        mockFind = jest.fn(function (query, options) {
            // Store the options for verification
            this._lastFindOptions = options;
            // Call the original find method
            return originalFind.call(this, query, options);
        });
        Collection.prototype.find = mockFind;
    });

    afterEach(async () => {
        // Restore original find method
        if (originalFind) {
            const Collection = require('mongodb').Collection;
            Collection.prototype.find = originalFind;
        }
        await commonAfterEach();
    });

    test('GraphQL federation entities query uses primary readPreference', async () => {
        const request = await createTestRequest();
        const entitiesQueryText = entitiesQuery.replace(/\\n/g, '');

        // Create test data
        let resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patientBundleResource)
            .set(getHeaders());

        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // Clear any previous mock calls
        mockFind.mockClear();

        // Execute federation entities query (uses __resolveReference)
        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {
                    representations: [
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
            .set(getGraphQLHeaders());

        // Verify the response is successful
        expect(resp.status).toBe(200);

        // Verify that find was called with primary readPreference
        expect(mockFind).toHaveBeenCalled();

        // Check if any of the find calls used primary readPreference
        const callsWithPrimaryReadPreference = mockFind.mock.calls.filter(call => {
            const options = call[1];
            return options && options.readPreference === ReadPreference.PRIMARY;
        });

        expect(callsWithPrimaryReadPreference.length).toBeGreaterThan(0);
    });

    test('Regular GraphQL query does NOT use explicit primary readPreference', async () => {
        const request = await createTestRequest();

        // Create test data
        let resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patientBundleResource)
            .set(getHeaders());

        expect(resp).toHaveMergeResponse([{ created: true }, { created: true }]);

        // Clear any previous mock calls
        mockFind.mockClear();

        // Execute regular GraphQL query (NOT federation entities)
        const regularQuery = `
            query {
                patientList {
                    entry {
                        resource {
                            id
                            resourceType
                        }
                    }
                }
            }
        `;

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: regularQuery
            })
            .set(getGraphQLHeaders());

        // Verify the response is successful
        expect(resp.status).toBe(200);

        // Verify that find was called
        expect(mockFind).toHaveBeenCalled();

        // Check that NONE of the find calls explicitly set primary readPreference
        // (they should use whatever is in the connection string)
        const callsWithPrimaryReadPreference = mockFind.mock.calls.filter(call => {
            const options = call[1];
            return options && options.readPreference === ReadPreference.PRIMARY;
        });

        // Regular queries should NOT have explicit primary readPreference
        expect(callsWithPrimaryReadPreference.length).toBe(0);
    });
});
