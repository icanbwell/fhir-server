const validPractitionerResourceWithoutProfile = require('./fixtures/valid_practitioner_without_profile.json');
// eslint-disable-next-line no-unused-vars
const validPractitionerResourceWithProfile = require('./fixtures/valid_practitioner_with_profile.json');

const expectedValidPractitionerResponse = require('./expected/valid_practitioner_response.json');

const USCorePractitionerProfile = require('./fixtures/us_core_profile_practitioner.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {RemoteFhirValidator} = require('../../../utils/remoteFhirValidator');
const {ConfigManager} = require('../../../utils/configManager');
const OperationOutcome = require('../../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');

class MockRemoteFhirValidator extends RemoteFhirValidator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor(
        {
            configManager
        }
    ) {
        super({configManager});
    }

    async fetchProfile({url}) {
        expect(url).toEqual('http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner');
        return USCorePractitionerProfile;
    }

    async updateProfile({profileJson}) {
        expect(profileJson).toEqual(USCorePractitionerProfile);
        return {};
    }

    // eslint-disable-next-line no-unused-vars
    async validateResourceAsync({resourceBody, resourceName, path}) {
        return new OperationOutcome({
            issue: [
                new OperationOutcomeIssue({
                    severity: 'error',
                    code: 'invalid',
                    diagnostics: 'Invalid resource',
                })
            ]
        });
    }
}

class MockConfigManager extends ConfigManager {
    get fhirValidationUrl() {
        return 'foo';
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
        test('Valid resource without profile', async () => {
            const mockRemoteFhirValidator = new MockRemoteFhirValidator({
                configManager: new ConfigManager()
            });
            const mockFetchProfile = jest.spyOn(mockRemoteFhirValidator, 'fetchProfile');
            mockFetchProfile.mockImplementation(() => USCorePractitionerProfile);
            const mockUpdateProfile = jest.spyOn(mockRemoteFhirValidator, 'updateProfile');
            mockUpdateProfile.mockImplementation(() => {
            });
            const mockValidateResourceAsync = jest.spyOn(mockRemoteFhirValidator, 'validateResourceAsync');
            mockValidateResourceAsync.mockImplementation(() => null);

            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                c.register('remoteFhirValidator', () => mockRemoteFhirValidator);
                return c;
            });
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
            expect(mockFetchProfile).toHaveBeenCalledTimes(0);
            expect(mockUpdateProfile).toHaveBeenCalledTimes(0);
            expect(mockValidateResourceAsync).toHaveBeenCalledTimes(1);
            mockFetchProfile.mockClear();
            mockUpdateProfile.mockClear();
            mockValidateResourceAsync.mockClear();
        });
    });
});
