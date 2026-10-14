// Shared fixtures for the Binary patient-scope integration suites in this directory.
//
// Model: two members (person A, person B) are linked to the SAME real Patient, so a clinical DocumentReference on
// that Patient is visible to both. Member A uploads a Binary through the patient-scoped create path (owned via
// securityContext = Patient/person.{A}) and the DocumentReference points at it through content.attachment.url.
// Every "B cannot see A's Binary" assertion in the suites is therefore about the Binary filter, not about the
// DocumentReference or Patient being hidden.
const { expect } = require('@jest/globals');
const { getHeaders, getHeadersWithCustomPayload, getTestContainer } = require('../../common');

const OWNER_TAG = { system: 'https://www.icanbwell.com/owner', code: 'client1' };
const ACCESS_TAG = { system: 'https://www.icanbwell.com/access', code: 'client1' };
const SHARED_PATIENT = 'shared-patient';
const meta = { source: 'https://example.com/test', security: [OWNER_TAG, ACCESS_TAG] };

const newPerson = (id) => ({
    resourceType: 'Person',
    id,
    birthDate: '1990-01-01',
    gender: 'male',
    meta,
    name: [{ family: id.toUpperCase(), given: ['TEST'], use: 'usual' }],
    link: [{ target: { reference: `Patient/${SHARED_PATIENT}`, type: 'Patient' }, assurance: 'level4' }]
});

const claims = (personUuid, scope) => ({
    scope,
    username: `${personUuid}@example.com`,
    clientFhirPersonId: personUuid,
    clientFhirPatientId: SHARED_PATIENT,
    bwellFhirPersonId: personUuid,
    bwellFhirPatientId: `${personUuid}-bwell-patient`,
    token_use: 'access'
});

const MIXED_SCOPE = 'patient/*.* user/*.* access/*.*';
const PURE_PATIENT_SCOPE = 'patient/Patient.read patient/Person.read patient/DocumentReference.read patient/Binary.read';

/** claims for a member token (use with getHeadersWithCustomPayload / getCustomGraphQLHeaders) */
const memberClaims = (personUuid, scope) => claims(personUuid, scope);
const memberWriter = (personUuid) => getHeadersWithCustomPayload(claims(personUuid, 'patient/Binary.write'));
const mixedHeaders = (personUuid) => getHeadersWithCustomPayload(claims(personUuid, MIXED_SCOPE));
const pureHeaders = (personUuid) => getHeadersWithCustomPayload(claims(personUuid, PURE_PATIENT_SCOPE));

/** the two read-capable token shapes every cross-member case is run with */
const READER_TOKENS = [
    { name: 'mixed token (patient/*.* user/*.* access/*.*)', headers: mixedHeaders, scope: MIXED_SCOPE },
    { name: 'pure patient token', headers: pureHeaders, scope: PURE_PATIENT_SCOPE }
];

/**
 * @param {import('supertest').SuperTest} request
 * @param {string} requestId
 */
const createHelpers = (request, requestId) => {
    const waitForPostSave = async () => {
        await getTestContainer().postRequestProcessor.waitTillDoneAsync({ requestId });
    };

    const merge = async (resourceType, body) => {
        const resp = await request
            .post(`/4_0_0/${resourceType}/1/$merge?validate=true`)
            .send(body)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        await waitForPostSave();
        return resp.body.uuid;
    };

    const uploadAsMember = async (personUuid, extra = {}) => {
        const created = await request
            .post('/4_0_0/Binary')
            .send({
                resourceType: 'Binary',
                id: 'ignored',
                meta,
                contentType: 'application/pdf',
                data: 'JVBERi0xLjQK',
                ...extra
            })
            .set(memberWriter(personUuid));
        expect(created).toHaveStatusCode(201);
        expect(created.body.securityContext.reference).toStrictEqual(`Patient/person.${personUuid}`);
        await waitForPostSave();
        return created.body.id;
    };

    const mergeDocumentReference = (id, binaryId) =>
        merge('DocumentReference', {
            resourceType: 'DocumentReference',
            id,
            meta,
            status: 'current',
            subject: { reference: `Patient/${SHARED_PATIENT}` },
            content: [{ attachment: { contentType: 'application/pdf', url: `Binary/${binaryId}` } }]
        });

    /**
     * shared Patient, persons A and B linked to it, A's uploaded Binary and a DocumentReference pointing at it
     * @return {Promise<{personA: string, personB: string, binaryId: string}>}
     */
    const seedSharedPatientWithOwnedBinary = async ({ uploadExtra } = {}) => {
        await merge('Patient', { resourceType: 'Patient', id: SHARED_PATIENT, meta, name: [{ family: 'SHARED' }] });
        const personA = await merge('Person', newPerson('person-a'));
        const personB = await merge('Person', newPerson('person-b'));
        const binaryId = await uploadAsMember(personA, uploadExtra);
        await mergeDocumentReference('doc-1', binaryId);
        return { personA, personB, binaryId };
    };

    return { waitForPostSave, merge, uploadAsMember, mergeDocumentReference, seedSharedPatientWithOwnedBinary };
};

const binaryIdsIn = (bundle) =>
    (bundle.entry || []).filter((e) => e.resource.resourceType === 'Binary').map((e) => e.resource.id);

module.exports = {
    OWNER_TAG,
    ACCESS_TAG,
    SHARED_PATIENT,
    MIXED_SCOPE,
    PURE_PATIENT_SCOPE,
    READER_TOKENS,
    meta,
    newPerson,
    memberClaims,
    memberWriter,
    mixedHeaders,
    pureHeaders,
    createHelpers,
    binaryIdsIn
};
