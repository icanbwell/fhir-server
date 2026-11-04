const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../utils/configManager');
const nock = require('nock');
const USCorePractitionerProfile = require('./fixtures/us_core_profile_practitioner.json');
const validPractitionerResourceWithProfile = require('./fixtures/valid_practitioner_with_profile.json');

const fhirValidationUrl = 'http://foo/fhir';
const profileUrl = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner';
const publisher = 'HL7 International - Cross-Group Projects';

class MockConfigManager extends ConfigManager {
    get fhirValidationUrl () {
        return fhirValidationUrl;
    }
}

const mockRemoteValidation = () => {
    let uploadedProfile = null;
    nock(fhirValidationUrl)
        .put('/StructureDefinition/us-core-practitioner', (body) => {
            uploadedProfile = body;
            return true;
        })
        .reply(200, {});
    nock(fhirValidationUrl)
        .post('/Practitioner/$validate', () => true)
        .reply(200, {
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'information', code: 'informational', details: { text: 'OK' } }]
        });
    return () => uploadedProfile;
};

describe('Profile upsert for remote validation', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('a profile fetched from its url is stored, tagged with its publisher and uploaded without internal fields', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        const fetchProfileScope = nock('http://hl7.org')
            .get('/fhir/us/core/StructureDefinition/us-core-practitioner')
            .reply(200, USCorePractitionerProfile);
        const getUploadedProfile = mockRemoteValidation();

        await request
            .post('/4_0_0/Practitioner/$validate')
            .send(validPractitionerResourceWithProfile)
            .set(getHeaders())
            .expect(200);

        expect(fetchProfileScope.isDone()).toBe(true);
        const uploaded = getUploadedProfile();
        expect(uploaded).toMatchObject({
            resourceType: 'StructureDefinition',
            id: 'us-core-practitioner',
            url: profileUrl,
            meta: {
                versionId: '1',
                source: profileUrl,
                security: [
                    { id: expect.any(String), system: 'https://www.icanbwell.com/owner', code: publisher },
                    { id: expect.any(String), system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: publisher }
                ]
            },
            jurisdiction: [{ coding: [{ id: expect.any(String), system: 'urn:iso:std:iso:3166', code: 'US' }] }]
        });
        expect(uploaded).not.toHaveProperty('_id');
        expect(uploaded).not.toHaveProperty('_uuid');
        expect(uploaded).not.toHaveProperty('_sourceId');
        expect(uploaded).not.toHaveProperty('_sourceAssigningAuthority');

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('StructureDefinition_4_0_0').find({}).toArray();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ id: 'us-core-practitioner', _uuid: expect.any(String), _sourceAssigningAuthority: publisher });
        expect(stored[0].meta.security).toEqual(uploaded.meta.security);
    });

    test('fields that are not part of a StructureDefinition are neither stored nor uploaded', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        const profileWithUnknownFields = {
            ...structuredClone(USCorePractitionerProfile),
            notAFhirField: 'x',
            meta: { ...structuredClone(USCorePractitionerProfile.meta), notAFhirField: 'x' }
        };
        nock('http://hl7.org')
            .get('/fhir/us/core/StructureDefinition/us-core-practitioner')
            .reply(200, profileWithUnknownFields);
        const getUploadedProfile = mockRemoteValidation();

        await request
            .post('/4_0_0/Practitioner/$validate')
            .send(validPractitionerResourceWithProfile)
            .set(getHeaders())
            .expect(200);

        const uploaded = getUploadedProfile();
        expect(uploaded).toMatchObject({ resourceType: 'StructureDefinition', url: profileUrl });
        expect(uploaded).not.toHaveProperty('notAFhirField');
        expect(uploaded.meta).not.toHaveProperty('notAFhirField');

        const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
        const stored = await db.collection('StructureDefinition_4_0_0').find({}).toArray();
        expect(stored).toHaveLength(1);
        expect(stored[0]).not.toHaveProperty('notAFhirField');
        expect(stored[0].meta).not.toHaveProperty('notAFhirField');
    });

    test('a profile that is already stored is uploaded from the database without fetching it again', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        nock('http://hl7.org')
            .get('/fhir/us/core/StructureDefinition/us-core-practitioner')
            .reply(200, USCorePractitionerProfile);
        const getFirstUpload = mockRemoteValidation();
        await request.post('/4_0_0/Practitioner/$validate').send(validPractitionerResourceWithProfile).set(getHeaders()).expect(200);

        const refetchScope = nock('http://hl7.org')
            .get('/fhir/us/core/StructureDefinition/us-core-practitioner')
            .reply(200, USCorePractitionerProfile);
        const getSecondUpload = mockRemoteValidation();
        await request.post('/4_0_0/Practitioner/$validate').send(validPractitionerResourceWithProfile).set(getHeaders()).expect(200);

        expect(refetchScope.isDone()).toBe(false);
        expect(getSecondUpload()).toEqual(getFirstUpload());
    });
});
