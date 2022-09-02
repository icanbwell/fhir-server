const validPractitionerResource = require('./fixtures/valid_practitioner.json');
const validPractitionerNoSecurityCodeResource = require('./fixtures/valid_practitioner_no_security_code.json');
const invalidPractitionerResource = require('./fixtures/invalid_practitioner.json');

const expectedValidPractitionerResponse = require('./expected/valid_practitioner_response.json');
const expectedValidPractitionerNoSecurityCodeResponse = require('./expected/valid_practitioner_no_security_code_response.json');
const expectedInvalidPractitionerResponse = require('./expected/invalid_practitioner_response.json');
const expectedInvalidPractitionerNoParametersResponse = require('./expected/invalid_practitioner_response_no_parameters.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach} = require('@jest/globals');

describe('Practitioner Update Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Validate', () => {
        test('Valid resource', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(validPractitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponse);
        });
        test('Valid resource with resource parameter', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            /**
             * http://www.hl7.org/fhir/parameters-example.json.html
             * @type {{parameter: [{resource: {resourceType: string, id: string, meta: {security: {}}, identifier: {}, active: boolean, name: {}, telecom: {}, address: {}, gender: string}, name: string}], resourceType: string}}
             */
            const parametersResource = {
                resourceType: 'Parameters',
                parameter: [{name: 'resource', resource: validPractitionerResource}],
            };
            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(parametersResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponse);
        });
        test('Valid resource but no security code', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(validPractitionerNoSecurityCodeResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerNoSecurityCodeResponse);
        });
        test('Invalid resource', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(invalidPractitionerResource)
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedInvalidPractitionerResponse);
        });
        test('Invalid resource with resource parameter', async () => {
            const request = await createTestRequest();
            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            /**
             * http://www.hl7.org/fhir/parameters-example.json.html
             */
            const parametersResource = {
                resourceType: 'Parameters',
                parameterBad: [{name: 'resource', resource: validPractitionerResource}],
            };
            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(parametersResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedInvalidPractitionerNoParametersResponse);
        });
    });
});
