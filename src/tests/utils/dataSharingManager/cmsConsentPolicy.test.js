const { describe, beforeEach, afterEach, test, jest, expect } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../common');

const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

const PERSON_UUID = '08f1b73a-e27c-456d-8a61-277f164a9a57-1';
const PATIENT_UUID = '08f1b73a-e27c-456d-8a61-277f164a9a57-2';

const buildPersonFixture = () => ({
    resourceType: 'Person',
    id: PERSON_UUID,
    meta: {
        source: 'https://cms-consent-policy-tests',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'cms-client' },
            { system: 'https://www.icanbwell.com/access', code: 'cms-client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'cms-client' }
        ]
    },
    name: [{ family: 'Family', given: ['First'] }],
    link: [
        {
            target: {
                reference: `Patient/${PATIENT_UUID}`
            }
        }
    ]
});

const buildPatientFixture = () => ({
    resourceType: 'Patient',
    id: PATIENT_UUID,
    meta: {
        source: 'https://cms-consent-policy-tests',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'cms-client' },
            { system: 'https://www.icanbwell.com/access', code: 'cms-client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'cms-client' }
        ]
    }
});

const buildConsentFixture = ({
    id = 'consent-policy-test',
    provisionType = 'permit',
    category = {
        system: 'http://www.icanbwell.com/consent-category',
        code: 'cms:share:records'
    }
} = {}) => ({
    resourceType: 'Consent',
    id,
    meta: {
        source: 'https://cms-consent-policy-tests',
        security: [
            { system: 'https://www.icanbwell.com/owner', code: 'cms-client' },
            { system: 'https://www.icanbwell.com/access', code: 'cms-client' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'cms-client' }
        ]
    },
    status: 'active',
    scope: {
        coding: [
            {
                system: 'http://terminology.hl7.org/CodeSystem/consentscope',
                code: 'patient-privacy',
                display: 'Patient Privacy'
            }
        ]
    },
    category: [
        {
            coding: [category]
        }
    ],
    patient: {
        reference: `Patient/person.${PERSON_UUID}`
    },
    dateTime: '2026-03-04T15:48:47.679Z',
    performer: [
        {
            reference: `Patient/person.${PERSON_UUID}`
        }
    ],
    sourceReference: {
        reference: 'DocumentReference/ff2ab53b-980a-5832-8159-7d49cbceba05'
    },
    provision: {
        type: provisionType,
        period: {
            start: '2026-03-04T15:48:47.679Z',
            end: '2026-09-04T14:48:47.679Z'
        },
        actor: [
            {
                reference: {
                    reference: `Patient/person.${PERSON_UUID}`
                },
                role: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                            code: 'IRCP',
                            display: 'Information Recipient'
                        }
                    ]
                }
            }
        ]
    }
});

describe('DataSharingManager.updateQueryConsideringCmsDataSharing — actor.consentPolicy stamping', () => {
    // The in-memory mongo does not have CONSENT_OF_LINKED_PERSON_INDEX defined,
    // so the .hint(...) call the consent manager makes would otherwise throw.
    // Mirrors the pattern used in cmsDataSharingPatientList.test.js and
    // cmsConsentManager.test.js.
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('stamps actor.consentPolicy when latestConsent exists', async () => {
        const request = await createTestRequest();

        // Seed Person (linked to Patient), Patient, and an active permit Consent.
        const mergeResp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([buildPersonFixture(), buildPatientFixture(), buildConsentFixture()])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();
        const actor = {};

        const resultQuery = await container.dataSharingManager.updateQueryConsideringCmsDataSharing({
            resourceType: 'Patient',
            patientIds: [PATIENT_UUID],
            query: {},
            actor
        });

        expect(actor.consentPolicy).toEqual(expect.stringMatching(/^Consent\/.+\?version=.+$/));

        // Sanity: the returned query should NOT be the short-circuit
        // { id: '__invalid__' } since we have a valid consent.
        expect(resultQuery).not.toEqual({ id: '__invalid__' });
    });

    test('does NOT stamp actor when no consent exists', async () => {
        // Seed only Person + Patient (no Consent).
        const request = await createTestRequest();

        const mergeResp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([buildPersonFixture(), buildPatientFixture()])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();
        const actor = {};

        const resultQuery = await container.dataSharingManager.updateQueryConsideringCmsDataSharing({
            resourceType: 'Patient',
            patientIds: [PATIENT_UUID],
            query: {},
            actor
        });

        expect(actor.consentPolicy).toBeUndefined();
        // Regression guard: no consent -> short-circuit query.
        expect(resultQuery).toEqual({ id: '__invalid__' });
    });

    test('safe when actor is null (no throw)', async () => {
        const request = await createTestRequest();

        const mergeResp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([buildPersonFixture(), buildPatientFixture(), buildConsentFixture()])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();

        await expect(
            container.dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: [PATIENT_UUID],
                query: {},
                actor: null
            })
        ).resolves.toBeDefined();
    });

    test('safe when actor is omitted (no throw)', async () => {
        const request = await createTestRequest();

        const mergeResp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([buildPersonFixture(), buildPatientFixture(), buildConsentFixture()])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();

        await expect(
            container.dataSharingManager.updateQueryConsideringCmsDataSharing({
                resourceType: 'Patient',
                patientIds: [PATIENT_UUID],
                query: {}
            })
        ).resolves.toBeDefined();
    });

    test('short-circuits with {id: \'__invalid__\'} when no consent (regression guard)', async () => {
        const request = await createTestRequest();

        // Seed only Person + Patient; no Consent.
        const mergeResp = await request
            .post('/4_0_0/Person/1/$merge')
            .send([buildPersonFixture(), buildPatientFixture()])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const container = getTestContainer();

        const resultQuery = await container.dataSharingManager.updateQueryConsideringCmsDataSharing({
            resourceType: 'Patient',
            patientIds: [PATIENT_UUID],
            query: {},
            actor: {}
        });

        expect(resultQuery).toEqual({ id: '__invalid__' });
    });
});
