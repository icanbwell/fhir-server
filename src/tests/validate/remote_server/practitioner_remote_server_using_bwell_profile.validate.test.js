const invalidPractitionerResourceUsingBwellProfile = require('./fixtures/invalid_practitioner_using_bwell_profile.json');

const expectedInvalidPractitionerResponseForUSCore = require('./expected/invalid_practitioner_using_us_core_profile.json');
const expectedInvalidPractitionerResponseForBwellProfile = require('./expected/invalid_practitioner_using_bwell_profile.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

const fhirValidationUrl = 'http://localhost:3001/fhir';

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
        test('Valid resource profile with us core profile', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(invalidPractitionerResourceUsingBwellProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/fe274326-fd32-4a06-a68d-9435aed8af98/$validate?profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedInvalidPractitionerResponseForUSCore,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
        });
        test('Valid resource profile with bwell profile', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });

            let resp = await request
                .get('/4_0_0/Practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Practitioner/$merge')
                .send(invalidPractitionerResourceUsingBwellProfile)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .get('/4_0_0/Practitioner/fe274326-fd32-4a06-a68d-9435aed8af98/$validate?profile=https://fhir.simplifier.net/bwellFHIRProfiles/StructureDefinition/pr-practitioner')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedInvalidPractitionerResponseForBwellProfile,
                resource => {
                    delete resource.details; // has lastUpdated
                    return resource;
                });
        });
    });
});
