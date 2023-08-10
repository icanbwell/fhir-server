const validPractitionerResourceWithProfile = require('./fixtures/valid_practitioner_with_profile.json');

const expectedValidPractitionerResponseWithProfile = require('./expected/valid_practitioner_response_with_profile.json');

const USCorePractitionerProfile = require('./fixtures/us_core_profile_practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');
const nock = require('nock');

const fhirValidationUrl = 'http://foo/fhir';

class MockConfigManager extends ConfigManager {
    get fhirValidationUrl() {
        return fhirValidationUrl;
    }
}

describe('Practitioner Update Tests 2', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });
    describe('Practitioner Validate 2', () => {
        test('Valid resource profile in body not url', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const getProfileScope = nock('http://hl7.org')
                .get('/fhir/us/core/StructureDefinition/us-core-practitioner')
                .reply(200, USCorePractitionerProfile);

            // http://foo/fhir/StructureDefinition
            const uploadProfileScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json',
                },
            })
                .post('/StructureDefinition', USCorePractitionerProfile)
                .reply(200, {});

            const validationScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json'
                },
            })
                .post(
                    '/Practitioner/$validate',
                    validPractitionerResourceWithProfile
                )
                .reply(200, {
                        'issue': {
                            'code': 'informational',
                            'details': {
                                'text': 'OK'
                            },
                            'expression': [
                                'Practitioner'
                            ],
                            'severity': 'information'
                        },
                        'resourceType': 'OperationOutcome'
                    }
                );

            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$validate')
                .send(validPractitionerResourceWithProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponseWithProfile);
            expect(getProfileScope.isDone()).toBeTruthy();
            expect(uploadProfileScope.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });
    });
});
