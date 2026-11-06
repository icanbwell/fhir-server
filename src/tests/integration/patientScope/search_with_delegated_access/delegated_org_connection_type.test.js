const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle() {
        return true;
    }

    get enableDelegatedAccessDetection() {
        return true;
    }
}

const CLIENT_ORG_ID = '1f0e9d8c-7b6a-4954-8321-0fedcba98765';
const CONSENT_ID = '6c2f4a1e-3b5d-5e7f-9a1b-2c3d4e5f6a7b';
const CLIENT_PERSON_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TREATMENT_PATIENT_ID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const PROA_PATIENT_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const OTHER_PATIENT_ID = '3d4e5f6a-7b8c-4d9e-8f1a-2b3c4d5e6f70';
const OBS_TREATMENT_ID = '4e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7081';
const OBS_PROA_ID = '5f6a7b8c-9d0e-4f1a-8b2c-4d5e6f708192';
const OBS_UNTAGGED_ID = '6a7b8c9d-0e1f-4a2b-9c3d-5e6f708192a3';
const OBS_OTHER_PERSON_ID = '7b8c9d0e-1f2a-4b3c-8d4e-6f708192a3b4';

const connectionTypeSystem = 'https://www.icanbwell.com/connectionType';

const tags = (owner, connectionType) => [
    { system: 'https://www.icanbwell.com/owner', code: owner },
    { system: 'https://www.icanbwell.com/access', code: owner },
    ...(connectionType ? [{ system: connectionTypeSystem, code: connectionType }] : [])
];

const patient = (id, owner, connectionType) => ({
    resourceType: 'Patient',
    id,
    meta: { source: 'test', security: tags(owner, connectionType) },
    gender: 'female',
    birthDate: '1980-01-01'
});

const observation = (id, patientId, owner, connectionType) => ({
    resourceType: 'Observation',
    id,
    meta: { source: 'test', security: tags(owner, connectionType) },
    status: 'final',
    code: { text: 'synthetic' },
    subject: { reference: `Patient/${patientId}` }
});

const clientPerson = {
    resourceType: 'Person',
    id: CLIENT_PERSON_ID,
    meta: { source: 'test', security: tags('client') },
    link: [
        { target: { reference: `Patient/${TREATMENT_PATIENT_ID}`, type: 'Patient' }, assurance: 'level4' },
        { target: { reference: `Patient/${PROA_PATIENT_ID}`, type: 'Patient' }, assurance: 'level4' }
    ]
};

const clientConsent = (securityLabel) => ({
    resourceType: 'Consent',
    id: CONSENT_ID,
    meta: { source: 'test', security: tags('bwell') },
    identifier: [{ id: 'clientSlug', system: 'https://www.icanbwell.com/clientSlug', value: 'test-client' }],
    status: 'active',
    scope: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'treatment' }]
    },
    category: [{ coding: [{ system: 'http://www.icanbwell.com/consent-category', code: 'dataSharing' }] }],
    performer: [{ reference: `Organization/${CLIENT_ORG_ID}` }],
    provision: {
        type: 'permit',
        period: { start: '2025-01-01T00:00:00.000Z' },
        actor: [{
            role: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType', code: 'IRCP' }] },
            reference: { reference: `Organization/${CLIENT_ORG_ID}` }
        }],
        purpose: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT' }],
        ...(securityLabel ? { securityLabel } : {})
    }
});

const delegatedOrgPayload = {
    scope: 'patient/*.read access/*.read',
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: CLIENT_PERSON_ID,
    clientFhirPatientId: TREATMENT_PATIENT_ID,
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access',
    act: { reference: `Organization/${CLIENT_ORG_ID}`, sub: 'client-org-sub' },
    entitlements: [`Consent/${CONSENT_ID}`]
};

describe('Delegated Organization actor connection-type filtering', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const seedData = async (request, consent) => {
        const fixtures = [
            ['Person', clientPerson],
            ['Patient', patient(TREATMENT_PATIENT_ID, 'client', 'treatment')],
            ['Patient', patient(PROA_PATIENT_ID, 'client', 'proa')],
            ['Patient', patient(OTHER_PATIENT_ID, 'other', 'treatment')],
            ['Observation', observation(OBS_TREATMENT_ID, TREATMENT_PATIENT_ID, 'client', 'treatment')],
            ['Observation', observation(OBS_PROA_ID, PROA_PATIENT_ID, 'client', 'proa')],
            ['Observation', observation(OBS_UNTAGGED_ID, TREATMENT_PATIENT_ID, 'client')],
            ['Observation', observation(OBS_OTHER_PERSON_ID, OTHER_PATIENT_ID, 'other', 'treatment')],
            ['Consent', consent]
        ];
        for (const [resourceType, body] of fixtures) {
            const resp = await request.post(`/4_0_0/${resourceType}/1/$merge?validate=true`).send(body).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
        }
    };

    const ALL_CLIENT_RESOURCES = [
        `Person/${CLIENT_PERSON_ID}`,
        `Patient/${TREATMENT_PATIENT_ID}`,
        `Patient/${PROA_PATIENT_ID}`,
        `Observation/${OBS_TREATMENT_ID}`,
        `Observation/${OBS_PROA_ID}`,
        `Observation/${OBS_UNTAGGED_ID}`
    ];

    test.each([
        [
            'a treatment connectionType label returns the client Person and only treatment-tagged data',
            [{ system: connectionTypeSystem, code: 'treatment' }],
            [`Person/${CLIENT_PERSON_ID}`, `Patient/${TREATMENT_PATIENT_ID}`, `Observation/${OBS_TREATMENT_ID}`]
        ],
        [
            'no connectionType label keeps the existing unfiltered behavior',
            undefined,
            ALL_CLIENT_RESOURCES
        ],
        [
            'a malformed connectionType label fails closed with an empty bundle',
            [{ system: connectionTypeSystem }],
            []
        ]
    ])('Person $everything: %s', async (_label, securityLabel, expectedResources) => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request, clientConsent(securityLabel));

        const resp = await request
            .get(`/4_0_0/Person/${CLIENT_PERSON_ID}/$everything`)
            .set(getHeadersWithCustomPayload(delegatedOrgPayload));

        expect(resp.status).toBe(200);
        const returned = (resp.body.entry || [])
            .map((e) => `${e.resource.resourceType}/${e.resource.id}`)
            .filter((ref) => !ref.startsWith('Consent/'));
        expect(returned.sort()).toEqual([...expectedResources].sort());
        // another Person's treatment-tagged data never leaks through the connection-type branch
        expect(returned).not.toContain(`Observation/${OBS_OTHER_PERSON_ID}`);
        expect(returned).not.toContain(`Patient/${OTHER_PATIENT_ID}`);
    });

    test('Observation search applies the same connection-type restriction', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedData(request, clientConsent([{ system: connectionTypeSystem, code: 'treatment' }]));

        const resp = await request
            .get('/4_0_0/Observation/')
            .set(getHeadersWithCustomPayload(delegatedOrgPayload));

        expect(resp.status).toBe(200);
        expect(resp.body.entry.map((e) => e.resource.id)).toEqual([OBS_TREATMENT_ID]);
    });
});
