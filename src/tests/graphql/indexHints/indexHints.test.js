const { describe, beforeEach, afterEach, test } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getGraphQLHeaders } = require('../../common');
const { customIndexes } = require('./mockCustomIndexes');
const { IndexProvider } = require('../../../indexes/indexProvider');

const patientBundleResource = require('./fixtures/patient_bundle.json');
const personBundleResource = require('./fixtures/person_bundle.json');

const fs = require('fs');
const path = require('path');

const queryWithIndexHint1 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_with_indexhint_1.graphql'),
    'utf8'
);
const queryWithIndexHint2 = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query_with_indexhint_2.graphql'),
    'utf8'
);

class MockIndexProvider extends IndexProvider {
    getIndexes() {
        // noinspection JSValidateTypes
        return customIndexes;
    }
}

describe('Graphql IndexHints Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient search using _setIndexHint', () => {
        test.only('search by given name and _setIndexHint should workkkkk', async () => {
            const request = await createTestRequest((container) => {
                container.register('indexProvider', (c) => new MockIndexProvider({
                    configManager: c.configManager
                }));
                return container;
            });

            const graphqlQueryTextWithIndexHint1 = queryWithIndexHint1.replace(/\\n/g, '');
            const graphqlQueryTextWithIndexHint2 = queryWithIndexHint2.replace(/\\n/g, '');
            const desiredSystem = 'https://www.icanbwell.com/queryIndexHint';

            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(personBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

            resp = await request
                .get('/4_0_0/Person/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(3);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse([{created: true}, {created: true}]);

            resp = await request
                .get('/4_0_0/Patient/')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(1);

            // now check that we get the right record back
            resp = await request
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryTextWithIndexHint1,
                })
                .set(getGraphQLHeaders());

            // Find the object with the specified system value
            let desiredObject = resp.body.data.patient.meta.tag.find(tag => tag.system === desiredSystem);

            // noinspection JSUnresolvedFunction
            expect(desiredObject['code']).toEqual('[id_1]');

            resp = await request
                .post('/graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryTextWithIndexHint2,
                })
                .set(getGraphQLHeaders());

            desiredObject = resp.body.data.patient.meta.tag.find(tag => tag.system === desiredSystem);

            // noinspection JSUnresolvedFunction
            expect(desiredObject['code']).toEqual('[uuid]');
        });
    });
});
