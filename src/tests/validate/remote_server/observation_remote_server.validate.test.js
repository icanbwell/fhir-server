const nock = require('nock');
const { ConfigManager } = require('../../../utils/configManager');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getHeaders,
} = require('../../common');

const heartRateProfile = require('./fixtures/heart_rate_profile.json');
const observation = require('./fixtures/observation.json');

const fhirValidationUrl = 'http://foo/fhir';

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
                    'content-type': 'application/fhir+json',
                },
            })
                .post('/StructureDefinition', (body) => {
                    return body.id === 'heartrate';
                })
                .reply(200, {});

            const validationScope = nock(`${fhirValidationUrl}`, {
                reqheaders: {
                    'accept-encoding': 'gzip, deflate',
                    accept: 'application/json',
                    'content-type': 'application/fhir+json',
                },
            })
                .post(
                    '/Observation/$validate?profile=http://hl7.org/fhir/StructureDefinition/heartrate',
                    (body) => body.resourceType === 'Observation' && body.id === '2354-InAgeCohort'
                )
                .reply(200, {
                    issue: {
                        code: 'informational',
                        details: {
                            text: 'OK',
                        },
                        expression: ['Observation'],
                        severity: 'information',
                    },
                    resourceType: 'OperationOutcome',
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
                            text: 'OK',
                        },
                        expression: ['Observation'],
                        severity: 'information',
                    },
                    resourceType: 'OperationOutcome',
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
    });
});
