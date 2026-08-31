// claim
const personResource = require('./fixtures/badReferenceFix/person.json');
const patientResource = require('./fixtures/badReferenceFix/patient.json');
const encounterResource = require('./fixtures/badReferenceFix/encounter.json');

// graph
const graphDefinitionResource = require('./fixtures/graph/bad_ref_graph.json');

// expected
const expectedResource = require('./fixtures/expected/expectedBadRef.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Bad Reference Graph tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Bad Reference in Resource does not bail', () => {
        test('Bad Reference in Resource does not bail', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Encounter')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Person/222a029a-ff26-4b16-b36c-1b6375deb433/$merge')
                .send(personResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Patient/f24f4aef-08a9-41c1-8280-b85d12049ab2/$merge')
                .send(patientResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Encounter/5d171fb0-75e7-4b7e-af6d-5db5402ce778/$merge')
                .send(encounterResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post(
                    '/4_0_0/Person/222a029a-ff26-4b16-b36c-1b6375deb433/$graph?contained=true'
                )
                .set(getHeaders())
                .send(graphDefinitionResource);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedResource);
        });
    });
});
