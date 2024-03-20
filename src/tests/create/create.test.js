// test file
const practitioner1Resource = require('./fixtures/Practitioner/practitioner1.json');
const practitioner2Resource = require('./fixtures/Practitioner/practitioner2.json');
const practitioner3Resource = require('./fixtures/Practitioner/practitioner3.json');
const practitioner4Resource = require('./fixtures/Practitioner/practitioner4.json');

// expected
const expectedPractitionerInitialResources = require('./fixtures/expected/expected_Practitioner_initial.json');
const expectedPractitionerResources = require('./fixtures/expected/expected_Practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { generateUUIDv5 } = require('../../utils/uid.util');
const { IdentifierSystem } = require('../../utils/identifierSystem');

describe('Practitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner create Tests', () => {
        test('create works', async () => {
            const request = await createTestRequest();
            // Case when meta.source doesn't exist
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            practitioner1Resource.meta.source = 'client';
            // ARRANGE
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(201);

            const id1 = resp.headers['content-location'].split('/').splice(5, 1)[0];
            expectedPractitionerResources.entry[0].resource.id = id1;
            expectedPractitionerInitialResources.entry[0].resource.id = id1;
            practitioner1Resource.id = id1;
            practitioner1Resource.meta.versionId = '1';
            // update identifier
            expectedPractitionerInitialResources.entry[0].resource.identifier.find(i => i.system === IdentifierSystem.sourceId).value = id1;
            expectedPractitionerInitialResources.entry[0].resource.identifier.find(i => i.system === IdentifierSystem.uuid).value = id1;

            resp = await request
                .get('/4_0_0/Practitioner?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerInitialResources);

            expect(
                resp.body.entry[0].resource.qualification[1].issuer.extension.find(e => e.id === 'uuid')
                    .valueString
            ).toStrictEqual(
                'Organization/' + generateUUIDv5('Stanford_Medical_School|client')
            );

            // pause enough so the lastUpdated time is later on the second resource so our sorting works properly
            await new Promise((resolve) => setTimeout(resolve, 3000));
            practitioner1Resource.active = false;

            resp = await request
                .post('/4_0_0/Practitioner')
                .send(practitioner1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(201);

            const id2 = resp.headers['content-location'].split('/').splice(5, 1)[0];
            expectedPractitionerResources.entry[1].resource.id = id2;
            // update identifier
            expectedPractitionerResources.entry[0].resource.identifier.find(i => i.system === IdentifierSystem.sourceId).value = id1;
            expectedPractitionerResources.entry[0].resource.identifier.find(i => i.system === IdentifierSystem.uuid).value = id1;
            expectedPractitionerResources.entry[1].resource.identifier.find(i => i.system === IdentifierSystem.sourceId).value = id2;
            expectedPractitionerResources.entry[1].resource.identifier.find(i => i.system === IdentifierSystem.uuid).value = id2;

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Practitioner back
            resp = await request
                .get('/4_0_0/Practitioner?_bundle=1&_sort=meta.lastUpdated')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerResources);
        });
        test('create reference validation works', async () => {
            const request = await createTestRequest();
            const resp = await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'qualification.1.issuer.reference: Stanford_Medical_School is an invalid reference'
            );
        });
        test('create validation for multiple or no owner tags works', async () => {
            const request = await createTestRequest();
            // Case when multiple owner tags provided.
            let resp = await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource Practitioner is having multiple security access tag with system: https://www.icanbwell.com/owner'
            );
            // Case when no owner tag provided.
            resp = await request
                .post('/4_0_0/Practitioner/')
                .send(practitioner4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(400);
            expect(
                resp.body.issue[0].details.text
            ).toStrictEqual(
                'Resource Practitioner is missing a security access tag with system: https://www.icanbwell.com/owner'
            );
        });
    });
});
