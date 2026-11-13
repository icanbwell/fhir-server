// DCON-6410: a member's own uploaded documents are not shared with their health circle in v1.
//
// The unit tests for this assert the SHAPE of the Mongo filter against a mocked database. That
// proves the branch is taken; it does not prove the filter matches the documents it is meant to.
// This test seeds two real DocumentReferences on the same Patient -- one carrying the
// member-upload category, one from a connected source -- and reads them back through the real
// query path, so the $not/$elemMatch semantics are exercised against Mongo rather than asserted.
//
// The non-delegate control in the second test is the point of the pair: it shows the exclusion is
// specific to a delegated actor, not a filter that hides the upload from everyone.
const { describe, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTokenWithCustomPayload,
    resetTimerAfterEach,
    fakeTimerBeforeEach,
    getHeadersWithCustomPayload
} = require('../../common');

const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const activeConsent = require('./fixtures/Consent/consentWithSensitiveCategoriesExcluded.json');

const memberUploadResource = require('./fixtures/DocumentReference/memberUpload.json');
const externalDocumentResource = require('./fixtures/DocumentReference/externalDocument.json');

const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }

    get enableDelegatedAccessDetection () {
        return true;
    }
}

const SCOPE = 'patient/Patient.read patient/DocumentReference.read access/*.read admin/*.read';

const basePayload = {
    scope: SCOPE,
    username: 'test',
    client_id: 'client',
    clientFhirPersonId: '7b99904f-2f85-51a3-9398-e2eed6854639',
    clientFhirPatientId: '24a5930e-11b4-5525-b482-669174917044',
    bwellFhirPersonId: 'master-person',
    bwellFhirPatientId: 'master-patient',
    token_use: 'access'
};

const delegatedPayload = {
    ...basePayload,
    act: {
        reference: 'RelatedPerson/fc2b3779-1db9-4780-bea1-73dc941b02a7',
        sub: 'delegated-sub-123'
    }
};

/**
 * Ids of the DocumentReferences in a search response, whether it came back as a Bundle or an array.
 * @param {Object} resp
 * @return {string[]}
 */
function documentIdsIn (resp) {
    const body = resp.body;
    const resources = Array.isArray(body)
        ? body
        : (body?.entry || []).map(e => e.resource);
    return resources.map(r => r.id).sort();
}

describe('DCON-6410: member-uploaded documents and delegated access', () => {
    const MOCK_DATE = new Date('2025-12-24T20:00:00.000Z');
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    afterAll(() => {
        cursorSpy.mockRestore();
    });

    beforeEach(async () => {
        await fakeTimerBeforeEach();
        jest.setSystemTime(MOCK_DATE);
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
        await resetTimerAfterEach();
    });

    /**
     * Seeds the person/patient graph, an active Consent for the delegate, and the two documents.
     * @param {import('supertest').Agent} request
     */
    async function seedAsync (request) {
        for (const [path, resource] of [
            ['/4_0_0/Person/1/$merge?validate=true', topLevelPersonResource],
            ['/4_0_0/Person/1/$merge?validate=true', person1Resource],
            ['/4_0_0/Person/1/$merge?validate=true', person2Resource],
            ['/4_0_0/Patient/1/$merge?validate=true', patient1Resource],
            ['/4_0_0/Consent/$merge?validate=true', activeConsent],
            ['/4_0_0/DocumentReference/1/$merge?validate=true', memberUploadResource],
            ['/4_0_0/DocumentReference/1/$merge?validate=true', externalDocumentResource]
        ]) {
            const resp = await request.post(path).send(resource).set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });
        }
    }

    test('a delegated actor gets the connected-source document but not the member upload', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedAsync(request);

        const resp = await request.get('/4_0_0/DocumentReference').set({
            Authorization: `Bearer ${getTokenWithCustomPayload(delegatedPayload)}`,
            Accept: 'application/fhir+json'
        });

        expect(resp.status).toBe(200);
        expect(documentIdsIn(resp)).toEqual(['external-doc-1']);
    });

    test('CONTROL: the member themselves still gets both documents', async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new MockConfigManager());
            return c;
        });
        await seedAsync(request);

        const resp = await request
            .get('/4_0_0/DocumentReference')
            .set(getHeadersWithCustomPayload(basePayload));

        expect(resp.status).toBe(200);
        expect(documentIdsIn(resp)).toEqual(['external-doc-1', 'member-upload-1']);
    });
});
