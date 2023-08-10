const validPractitionerResourceWithoutProfile = require('./fixtures/valid_practitioner_without_profile.json');

const expectedValidPractitionerResponse = require('./expected/valid_practitioner_response.json');

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
const deepcopy = require('deepcopy');
const {SecurityTagSystem} = require('../../../utils/securityTagSystem');

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
        test('Valid resource profile when cached', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const profile = deepcopy(USCorePractitionerProfile);
            profile.meta = profile.meta || {};
            profile.meta.versionId = '1';
            profile.meta.source = 'http://foo/fhir/StructureDefinition/us-core-practitioner';
            profile.meta.security = [
                {
                    system: SecurityTagSystem.owner,
                    code: profile.publisher || 'profile',
                },
                {
                    system: SecurityTagSystem.sourceAssigningAuthority,
                    code: profile.publisher || 'profile',
                },
            ];

            // http://foo/fhir/StructureDefinition
            const uploadProfileScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json',
                },
            })
                .post('/StructureDefinition')
                .reply(200, {});

            const validationScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json'
                },
            })
                .post(
                    '/Practitioner/$validate?profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner',
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
                .post('/4_0_0/StructureDefinition/$merge')
                .send(profile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Practitioner/$validate?profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner')
                .send(validPractitionerResourceWithoutProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponse);
            expect(uploadProfileScope.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });
    });
});
