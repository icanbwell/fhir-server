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
const USCorePractitionerProfile = require('./fixtures/us_core_profile_practitioner.json');
const validPractitionerResourceWithProfile = require('./fixtures/valid_practitioner_with_profile.json');
const expectedValidPractitionerResponseWithProfile = require('./expected/valid_practitioner_response_with_profile.json');
const deepcopy = require('deepcopy');
const {SecurityTagSystem} = require('../../../utils/securityTagSystem');
const invalidPractitionerResource = require('./fixtures/invalid_practitioner.json');
const invalidPractitionerResource1 = require('./fixtures/invalid_practitioner_1.json');

const expectedInvalidPractitionerResponse = require('./expected/invalid_practitioner_response.json');
const expected404FromProfile = require('./expected/404_from_profile_url.json');
const expected404FromProfileInsideResource = require('./expected/404_from_profile_url_indside_resource.json');

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

    describe('Practitioner Validate By Id', () => {
        test('Valid resource no profile', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const validationScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json'
                },
            })
                .post(
                    '/Practitioner/$validate',
                    body => body.resourceType === 'Practitioner' && body.id === '4657'
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
                .post('/4_0_0/Practitioner/$merge')
                .send(validPractitionerResourceWithoutProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/4657/$validate')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponse,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });

            expect(validationScope.isDone()).toBeTruthy();
        });
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
                .post('/StructureDefinition', body => body.id === 'us-core-practitioner')
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
                    body => body.resourceType === 'Practitioner' && body.id === '4657'
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
                .post('/4_0_0/Practitioner/$merge')
                .send(validPractitionerResourceWithProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/4657/$validate')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponseWithProfile,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
            expect(getProfileScope.isDone()).toBeTruthy();
            expect(uploadProfileScope.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });
        test('Valid resource profile in url not body', async () => {
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
                .post('/StructureDefinition', body => body.id === 'us-core-practitioner')
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
                    body => body.resourceType === 'Practitioner' && body.id === '4657'
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
                .post('/4_0_0/Practitioner/$merge')
                .send(validPractitionerResourceWithoutProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/4657/$validate?profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponse,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
            expect(getProfileScope.isDone()).toBeTruthy();
            expect(uploadProfileScope.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });
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
                .post('/StructureDefinition', body => body.id === 'us-core-practitioner')
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
                    body => body.resourceType === 'Practitioner' && body.id === '4657'
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
                .post('/4_0_0/Practitioner/$merge')
                .send(validPractitionerResourceWithoutProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/4657/$validate?profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedValidPractitionerResponse,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
            expect(uploadProfileScope.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });
        test('Invalid resource', async () => {
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
                .post('/StructureDefinition', body => body.id === 'us-core-practitioner')
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
                    body => body.resourceType === 'Practitioner' && body.id === '4657'
                )
                .reply(200, {
                        'resourceType': 'OperationOutcome',
                        'issue': [
                            {
                                'severity': 'error',
                                'code': 'processing',
                                'details': {
                                    'coding': [
                                        {
                                            'system': 'http://hl7.org/fhir/java-core-messageId',
                                            'code': 'VALIDATION_VAL_PROFILE_UNKNOWN_NOT_POLICY'
                                        }
                                    ]
                                },
                                'diagnostics': "Profile reference 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient' has not been checked because it is unknown, and the validator is set to not fetch unknown profiles",
                                'location': [
                                    'Patient.meta.profile[0]',
                                    'Line 1, Col 2'
                                ]
                            }
                        ]
                    }
                );

            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(invalidPractitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/4657/$validate?profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedInvalidPractitionerResponse,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
            expect(getProfileScope.isDone()).toBeTruthy();
            expect(uploadProfileScope.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });

        test('Bad Request response when unable to fetch the profile for given url', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            const getProfileScope = nock('http://hl7.org')
                .get('/fhir/us/core/StructureDefinition/us-core-practitioner')
                .reply(404, {
                    msg: 'URL Not found'
                });

            // http://foo/fhir/StructureDefinition
            const uploadProfileScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json',
                },
            })
                .post('/StructureDefinition', body => body.id === 'us-core-practitioner')
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
                    body => body.resourceType === 'Practitioner' && body.id === '4657'
                )
                .reply(200, {
                        'resourceType': 'OperationOutcome',
                        'issue': [
                            {
                                'severity': 'error',
                                'code': 'processing',
                                'details': {
                                    'coding': [
                                        {
                                            'system': 'http://hl7.org/fhir/java-core-messageId',
                                            'code': 'VALIDATION_VAL_PROFILE_UNKNOWN_NOT_POLICY'
                                        }
                                    ]
                                },
                                'diagnostics': "Profile reference 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient' has not been checked because it is unknown, and the validator is set to not fetch unknown profiles",
                                'location': [
                                    'Patient.meta.profile[0]',
                                    'Line 1, Col 2'
                                ]
                            }
                        ]
                    }
                );

            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(invalidPractitionerResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/4657/$validate?profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expected404FromProfile,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
            expect(getProfileScope.isDone()).toBeTruthy();
            expect(uploadProfileScope.isDone()).toBeFalsy();
            expect(validationScope.isDone()).toBeFalsy();
        });

        test('should throw bad request for profile present inside resource', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            // http://foo/fhir/StructureDefinition
            const uploadProfileScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    'accept': 'application/json',
                    'content-type': 'application/fhir+json',
                },
            })
                .post('/StructureDefinition', body => body.id === 'us-core-practitioner')
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
                    body => body.resourceType === 'Practitioner' && body.id === '4657'
                )
                .reply(200, {
                        'resourceType': 'OperationOutcome',
                        'issue': [
                            {
                                'severity': 'error',
                                'code': 'processing',
                                'details': {
                                    'coding': [
                                        {
                                            'system': 'http://hl7.org/fhir/java-core-messageId',
                                            'code': 'VALIDATION_VAL_PROFILE_UNKNOWN_NOT_POLICY'
                                        }
                                    ]
                                },
                                'diagnostics': "Profile reference 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient' has not been checked because it is unknown, and the validator is set to not fetch unknown profiles",
                                'location': [
                                    'Patient.meta.profile[0]',
                                    'Line 1, Col 2'
                                ]
                            }
                        ]
                    }
                );

            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(invalidPractitionerResource1)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // http://hl7.org/fhir/us/core/StructureDefinition/invalid
            const getProfileScopeInternal = nock('http://hl7.org')
                .get('/fhir/us/core/StructureDefinition/invalid')
                .reply(404, {
                    msg: 'URL Not found'
                });

            resp = await request
            .get('/4_0_0/Practitioner/4657/$validate')
            .set(getHeaders());

            expect(getProfileScopeInternal.isDone()).toBeTruthy();
            expect(uploadProfileScope.isDone()).toBeFalsy();
            expect(validationScope.isDone()).toBeFalsy();

            expect(resp).toHaveResponse(expected404FromProfileInsideResource,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
        });
    });
});
