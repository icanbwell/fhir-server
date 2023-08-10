const validPractitionerResourceWithoutProfile = require('./fixtures/valid_practitioner_without_profile.json');

const expectedValidPractitionerResponse = require('./expected/valid_practitioner_response.json');

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

describe('Practitioner Update Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Practitioner Validate', () => {
        test('Valid resource no profile', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const validationScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json',
                    'content-length': 863
                },
            })
                .post(
                    '/Practitioner/$validate',
                    validPractitionerResourceWithoutProfile
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
                .send(validPractitionerResourceWithoutProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponse);

            expect(validationScope.isDone()).toBeTruthy();
        });
    });
});
