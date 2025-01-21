const fs = require('fs');
const path = require('path');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest,
    getCustomGraphQLHeaders
} = require('../../common');

const patient1Resource = require('./fixtures/patient/patient1.json');
const person1Resource = require('./fixtures/person/person1.json');
const binary1Resource = require('./fixtures/binary/binary1.json');
const binary2Resource = require('./fixtures/binary/binary2.json');
const documentReference1Resource = require('./fixtures/documentReference/documentReference1.json');
const documentReference2Resource = require('./fixtures/documentReference/documentReference2.json');

const expectedDocumentReferenceWithBinaryResponse = require('./fixtures/expected/expectedDocumentReferenceWithBinary.json');
const expectedDocumentReferenceWithBinaryForPatientScopeResponse = require('./fixtures/expected/expectedDocumentReferenceWithBinaryForPatientScope.json');

const documentReferenceWithBinaryQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query/documentReferenceWithBinary.graphql'),
    'utf8'
);

const documentReferenceWithBinaryUsingSpreadQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query/documentReferenceWithBinaryUsingSpread.graphql'),
    'utf8'
);

describe('GraphQL DocumentReference Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('GraphQL DocumentReference with linked Binary resource', async () => {
        const request = await createTestRequest();
        let graphqlQueryText = documentReferenceWithBinaryQuery.replace(/\\n/g, '');

        resp = await request.post('/4_0_0/Binary/1/$merge').send(binary1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Binary/2/$merge').send(binary2Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/DocumentReference/1/$merge')
            .send(documentReference1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/DocumentReference/2/$merge')
            .send(documentReference2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Result should have single binary as sourceAssigningAuthority in one
        // DocumentReference and binary are differnt and linked using sourceId
        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedDocumentReferenceWithBinaryResponse);

        // query using spread operation
        graphqlQueryText = documentReferenceWithBinaryUsingSpreadQuery.replace(/\\n/g, '');
        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedDocumentReferenceWithBinaryResponse);
    });

    test('GraphQL DocumentReference with linked Binary resource using patient scope', async () => {
        const request = await createTestRequest();
        let graphqlQueryText = documentReferenceWithBinaryQuery.replace(/\\n/g, '');

        resp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send(patient1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/Person/1/$merge')
            .send(person1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Binary/1/$merge').send(binary1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request.post('/4_0_0/Binary/2/$merge').send(binary2Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/DocumentReference/1/$merge')
            .send(documentReference1Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .post('/4_0_0/DocumentReference/2/$merge')
            .send(documentReference2Resource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        const patient_scope = {
            scope: 'access/*.* patient/*.* user/*.*',
            username: 'patient-123@example.com',
            clientFhirPersonId: 'person1',
            clientFhirPatientId: 'patient1',
            bwellFhirPersonId: 'person1',
            bwellFhirPatientId: 'patient1',
            token_use: 'access'
        };

        resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getCustomGraphQLHeaders(patient_scope));

        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedDocumentReferenceWithBinaryForPatientScopeResponse);
    });
});
