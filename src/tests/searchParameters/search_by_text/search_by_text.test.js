// test file
const medication1Resource = require('./fixtures/Medication/medication1.json');
const medication2Resource = require('./fixtures/Medication/medication2.json');
const medication3Resource = require('./fixtures/Medication/medication3.json');
const medication4Resource = require('./fixtures/Medication/medication4.json');
const medication5Resource = require('./fixtures/Medication/medication5.json');
const compositionResource1 = require('./fixtures/Composition/composition1.json');

// expected
const expectedCompositionResources1 = require('./fixtures/expected/expected_composition1.json');
const expectedCompositionResources2 = require('./fixtures/expected/expected_composition2.json');
const expectedMedicationResources1 = require('./fixtures/expected/expected_medication1.json');
const expectedMedicationResources2 = require('./fixtures/expected/expected_medication2.json');
const expectedMedicationResources3 = require('./fixtures/expected/expected_medication3.json');
const expectedMedicationResources4 = require('./fixtures/expected/expected_medication4.json');
const expectedMedicationResources5 = require('./fixtures/expected/expected_medication5.json');
const expectedMedicationResources6 = require('./fixtures/expected/expected_medication6.json');
const expectedMedicationResources7 = require('./fixtures/expected/expected_medication7.json');
const expectedMedicationResources8 = require('./fixtures/expected/expected_medication8.json');
const expectedMedicationResources9 = require('./fixtures/expected/expected_medication9.json');
const expectedMedicationResources10 = require('./fixtures/expected/expected_medication10.json');
const expectedMedicationResources11 = require('./fixtures/expected/expected_medication11.json');
const expectedMedicationResources12 = require('./fixtures/expected/expected_medication12.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Search By Text', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Search By Code Tests', () => {
        test('Search By Code works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/1/$merge?validate=true')
                .send(medication1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Medication/1/$merge?validate=true')
                .send(medication2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Medication/1/$merge?validate=true')
                .send(medication3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Medication back
            resp = await request
                .get('/4_0_0/Medication/?_bundle=1&code:text=prednisoLONE&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources1);
        });

        test('Search By Code Text for multiple comma separated texts', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?code:text=predniso,sample&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources3);
        });

        test('Search By Code Text starting with a given text', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication3Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?code:text=pred&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources4);
        });

        test('Search By Code Text with given text anywhere in the string', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication3Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?code:text=Record&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources5);
        });
        test('Search By Code Text with given text exactly matches the string', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication3Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?code:text=prednisolone 1 MG/ML [Pediapred]&_debug=1&_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources6);
        });
    });

    describe('Search By Fields', () => {
        test('Search By Section Text in Composition', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Composition/$merge?validate=true')
                .send(compositionResource1)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Composition?section:text=Appointment&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCompositionResources1);
        });

        test('Search By Section Text and Identifier Text in Composition', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Composition/$merge?validate=true')
                .send(compositionResource1)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Composition?section:text=Appointment&identifier:text=abc&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedCompositionResources2);
        });

    })

    describe('Seach By Identifier Tests', () => {

        test('Search By Indentifier Text via identifier.type.text field', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication4Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?identifier:text=predniso&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources2);
        });


        test('Search By Identifier Text for multiple comma separated texts', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication5Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?identifier:text=predniso,sample&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources7);
        });

        test('Search By Identifier Text starting with a given text', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?identifier:text=pred&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources8);
        });


        test('Search By Identifier Text with given text anywhere in the string', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication3Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?identifier:text=Record&_debug=1&_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources9);
        });

        test('Search By Identifier Text with given text exactly matches the string', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?identifier:text=prednisoLONE Record Number&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources10);
        });
    });

    describe('Search by Code and Identifier Test', () => {
        test('Search By Identifier Text and Code Text when both works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?identifier:text=prednisoLONE&code:text=Foo&_debug=1&_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources11);
        });

        test('Search By Identifier Text and Code Text when only one text present', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Medication/$merge?validate=true')
                .send(medication4Resource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            resp = await request
                .get('/4_0_0/Medication?identifier:text=prednisoLONE&code:text=ABC&_debug=1&_bundle=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMedicationResources12);
        });
    });
});
