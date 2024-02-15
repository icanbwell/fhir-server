const nock = require('nock');
const { ConfigManager } = require('../../../utils/configManager');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders
} = require('../../common');

const heartRateProfile = require('./fixtures/heart_rate_profile.json');
const bodyHeightProfile = require('./fixtures/bodyheight_profile.json');
const bodyTempProfile = require('./fixtures/bodytemp_profile.json');
const observation = require('./fixtures/observation.json');
const observationWithMultipleProfiles = require('./fixtures/observation_with_multiple_profiles.json');

const fhirValidationUrl = 'http://foo/fhir';
const {describe, beforeEach, afterEach, test, expect} = require('@jest/globals');

class MockConfigManager extends ConfigManager {
    get fhirValidationUrl() {
        return fhirValidationUrl;
    }
}

describe('Remote Server Validate', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Validate Observation Test Cases', () => {
        test('should validate observation using profile mapper', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const getProfileScope = nock('http://hl7.org')
                .get('/fhir/R4/heartrate.profile.json')
                .reply(200, heartRateProfile);

            const uploadProfileScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    accept: 'application/json',
                    'content-type': 'application/fhir+json'
                }
            })
                .put('/StructureDefinition/heartrate', (body) => {
                    return body.id === 'heartrate';
                })
                .reply(200, {});

            const validationScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    accept: 'application/json',
                    'content-type': 'application/fhir+json'
                }
            })
                .post(
                    '/Observation/$validate?profile=http://hl7.org/fhir/StructureDefinition/heartrate',
                    (body) => body.resourceType === 'Observation' && body.id === '2354-InAgeCohort'
                )
                .reply(200, {
                    issue: {
                        code: 'informational',
                        details: {
                            text: 'OK'
                        },
                        expression: ['Observation'],
                        severity: 'information'
                    },
                    resourceType: 'OperationOutcome'
                });
            let resp = await request.get('/4_0_0/Observation').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observation)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(
                    '/4_0_0/Observation/2354-InAgeCohort/$validate?profile=http://hl7.org/fhir/StructureDefinition/heartrate'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(
                {
                    expression: ['Observation/2354-InAgeCohort'],
                    issue: {
                        code: 'informational',
                        details: {
                            text: 'OK'
                        },
                        expression: ['Observation'],
                        severity: 'information'
                    },
                    resourceType: 'OperationOutcome'
                },
                (resource) => {
                    delete resource.details; // has lastUpdated
                    return resource;
                }
            );
            expect(getProfileScope.isDone()).toBeTruthy();
            expect(uploadProfileScope.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });

        test('should not fetch profile from url if already present inside fhir db', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const heartRateProfileScope = nock('http://hl7.org')
                .get('/fhir/R4/heartrate.profile.json')
                .once()
                .reply(200, heartRateProfile);

            const bodyTemperatureProfileScope = nock('http://hl7.org')
                .get('/fhir/R4/bodytemp.profile.json')
                .once()
                .reply(200, bodyTempProfile);

            const bodyHeightProfileScope = nock('http://hl7.org')
                .get('/fhir/R4/bodyheight.profile.json')
                .once()
                .reply(200, bodyHeightProfile);

            const updateHeartRateProfile = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    accept: 'application/json',
                    'content-type': 'application/fhir+json'
                }
            })
                .put(`/StructureDefinition/${heartRateProfile.id}`, (body) => {
                    return body.id === heartRateProfile.id;
                })
                // called twice
                .twice()
                .reply(200, {});
            const updateHeightProfile = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    accept: 'application/json',
                    'content-type': 'application/fhir+json'
                }
            })
                .put(`/StructureDefinition/${bodyHeightProfile.id}`, (body) => {
                    return body.id === bodyHeightProfile.id;
                })
                // twice
                .twice()
                .reply(200, {});
            const updateBodyTempProfile = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    accept: 'application/json',
                    'content-type': 'application/fhir+json'
                }
            })
                .put(`/StructureDefinition/${bodyTempProfile.id}`, (body) => {
                    return body.id === bodyTempProfile.id;
                })
                // called twice
                .twice()
                .reply(200, {});

            const validationScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    accept: 'application/json',
                    'content-type': 'application/fhir+json'
                }
            })
                .post(
                    '/Observation/$validate?profile=http://hl7.org/fhir/StructureDefinition/heartrate',
                    (body) => body.resourceType === 'Observation' && body.id === '2354-InAgeCohort'
                )
                // should be called exactly twice
                .twice()
                .reply(200, {
                    issue: {
                        code: 'informational',
                        details: {
                            text: 'OK'
                        },
                        expression: ['Observation'],
                        severity: 'information'
                    },
                    resourceType: 'OperationOutcome'
                });

            // create observation
            let resp = await request.get('/4_0_0/Observation').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Observation/$merge')
                .send(observationWithMultipleProfiles)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(
                    '/4_0_0/Observation/2354-InAgeCohort/$validate?profile=http://hl7.org/fhir/StructureDefinition/heartrate'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(
                {
                    expression: ['Observation/2354-InAgeCohort'],
                    issue: {
                        code: 'informational',
                        details: {
                            text: 'OK'
                        },
                        expression: ['Observation'],
                        severity: 'information'
                    },
                    resourceType: 'OperationOutcome'
                },
                (resource) => {
                    delete resource.details; // has lastUpdated
                    return resource;
                }
            );

            // these are called only once till now
            expect(updateBodyTempProfile.isDone()).toBeFalsy();
            expect(updateHeightProfile.isDone()).toBeFalsy();
            expect(updateHeartRateProfile.isDone()).toBeFalsy();

            // these will be called only once
            expect(heartRateProfileScope.isDone()).toBeTruthy();
            expect(bodyHeightProfileScope.isDone()).toBeTruthy();
            expect(bodyTemperatureProfileScope.isDone()).toBeTruthy();

            resp = await request
                .get(
                    '/4_0_0/Observation/2354-InAgeCohort/$validate?profile=http://hl7.org/fhir/StructureDefinition/heartrate'
                )
                .set(getHeaders());
            expect(resp).toHaveResponse(
                {
                    expression: ['Observation/2354-InAgeCohort'],
                    issue: {
                        code: 'informational',
                        details: {
                            text: 'OK'
                        },
                        expression: ['Observation'],
                        severity: 'information'
                    },
                    resourceType: 'OperationOutcome'
                },
                (resource) => {
                    delete resource.details; // has lastUpdated
                    return resource;
                }
            );

            // should be completed by now
            expect(updateBodyTempProfile.isDone()).toBeTruthy();
            expect(updateHeightProfile.isDone()).toBeTruthy();
            expect(updateHeartRateProfile.isDone()).toBeTruthy();
            expect(validationScope.isDone()).toBeTruthy();
        });
    });
});
