/**
 * SEC-1580 W-chain: confirmed exploit chain from the FHIR Security Data Model Verification
 * review doc (Phase 1 of docs/superpowers/plans/2026-08-04-security-review-test-coverage.md).
 *
 * proaConsentManager.getPatientIdsWithConsent (src/operations/search/proaConsentManager.js) only
 * checks that a Consent's OWN meta.security owner tag matches the caller's tenant -- it never
 * checks that the Consent's *referenced* patient, or any other patient reachable from the same
 * Person node, is actually owned by that tenant. Once a match is found, it unlocks EVERY patient
 * linked from the same Person (bwellPersonFinder's personToLinkedPatientsMap), not just the one
 * the Consent names.
 *
 * resourceValidator.validatePatientReference's array-field branch (src/operations/common/
 * resourceValidator.js) only protects genuine patient/*-scoped (isUser: true) callers -- a caller
 * using user/* + access/* scopes (isUser: false) can freely add a new Person.link entry with zero
 * check on the target's ownership (fixed for that case by DCON-4844, not yet merged as of this
 * test).
 *
 * The consent-unlock traversal is keyed off a *Person*, not a Patient -- it only activates for a
 * Person-scoped $everything or the proxy-patient form (Patient/person.<personUuid>/$everything),
 * confirmed against src/utils/bwellPersonFinder.js and src/operations/search/dataSharingManager.js.
 *
 * W-chain (Task 1.1): Tenant B (1) self-grants a Consent it owns, referencing Tenant A's patient,
 * then (2) grafts a Person.link from Tenant B's own Person to Tenant A's patient, then (3) reads
 * $everything on Tenant B's own Person (proxy-patient form). Neither write is rejected today, and
 * the link graft makes Tenant A's patient a candidate for the (self-granted) consent unlock.
 *
 * W1 (Task 1.2): the self-grant in isolation, without the link graft -- Tenant A's patient is
 * never a candidate in Tenant B's own link graph, so it should NOT be reachable via $everything
 * regardless of the self-granted consent. This isolates which half of the chain the eventual fix
 * needs to target: confirmed by running both tests against DCON-4844's Person.link fix applied
 * locally -- W1 already passed before that fix, and the W-chain test then passed too, so
 * DCON-4844 (PR #2436) closing the Person.link write-path gap is a SUFFICIENT fix for the whole
 * chain. No separate consent-write-path fix is needed. The W-chain test stays skipped (not fixed
 * here) only because DCON-4844 isn't merged into main yet -- un-skip it once that PR lands.
 */
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { DatabaseCursor } = require('../../../../dataLayer/databaseCursor');

const OWNER = 'https://www.icanbwell.com/owner';
const ACCESS = 'https://www.icanbwell.com/access';
const CONNECTION_TYPE = 'https://www.icanbwell.com/connectionType';

function patient (id, ownerCode, { connectionType } = {}) {
    return {
        resourceType: 'Patient',
        id,
        meta: {
            source: ownerCode,
            security: [
                { system: OWNER, code: ownerCode },
                { system: ACCESS, code: ownerCode },
                ...(connectionType ? [{ system: CONNECTION_TYPE, code: connectionType }] : [])
            ]
        },
        birthDate: '2017-01-01',
        gender: 'female',
        name: [{ use: 'usual', family: 'TEST', given: ['TEST'] }]
    };
}

function person (id, ownerCode, linkedPatientRefs) {
    return {
        resourceType: 'Person',
        id,
        meta: {
            source: ownerCode,
            security: [
                { system: OWNER, code: ownerCode },
                { system: ACCESS, code: ownerCode }
            ]
        },
        link: linkedPatientRefs.map(reference => ({
            target: { reference, type: 'Patient' },
            assurance: 'level4'
        }))
    };
}

function selfGrantedConsent (id, ownerCode, patientReference) {
    return {
        resourceType: 'Consent',
        id,
        meta: {
            source: ownerCode,
            security: [
                { system: OWNER, code: ownerCode },
                { system: ACCESS, code: ownerCode }
            ]
        },
        status: 'active',
        category: [{
            coding: [{ system: 'http://www.icanbwell.com/consent-category', code: 'dataSharing' }]
        }],
        scope: {
            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }]
        },
        patient: { reference: patientReference },
        dateTime: '2026-08-04T00:00:00.000Z',
        provision: { type: 'permit' }
    };
}

function observation (id, ownerCode, patientId) {
    return {
        resourceType: 'Observation',
        id,
        meta: {
            source: ownerCode,
            security: [
                { system: OWNER, code: ownerCode },
                { system: ACCESS, code: ownerCode }
            ]
        },
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
        subject: { reference: `Patient/${patientId}` }
    };
}

/**
 * @param {Object[]} mergeResults
 * @param {string} id
 * @returns {string}
 */
function uuidOf (mergeResults, id) {
    return mergeResults.find(r => r.id === id).uuid;
}

describe('SEC-1580 W-chain: consent self-grant + Person.link graft (Task 1.1)', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    // Confirmed open against current main: Tenant A's patient demographic record leaks into
    // Tenant B's $everything bundle. Root cause is the Person.link write path (resourceValidator's
    // isUser-gated array check never runs for user/*+access/* callers) -- DCON-4844 closes that
    // gap but is not yet merged. Skipped (not file-quarantined) so the file's other two tests --
    // real, currently-passing regression guards -- still run in CI. See DCON-4847.
    test.skip('the full exploit sequence: self-granted consent + link graft leaks tenant A data via $everything', async () => {
        const request = await createTestRequest();

        // Tenant A: owns patA (PROA-connectionType-tagged, matching the default consent-connection
        // allowlist) plus an Observation on it. No relationship to Tenant B yet.
        const patA = patient('patA', 'tenant_a', { connectionType: 'proa' });
        const obsA = observation('obsA', 'tenant_a', 'patA');

        // Tenant B: its own Person/Patient, unrelated to Tenant A.
        const patB = patient('patB', 'tenant_b');
        const personB = person('personB', 'tenant_b', ['Patient/patB']);

        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([patA, obsA, patB, personB])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });
        const personBUuid = uuidOf(mergeResp.body, 'personB');
        // Referencing patA by its real _uuid (rather than the bare source id "patA") matters here:
        // a bare cross-tenant reference gets "enriched" by assuming the SAME authority as the
        // referencing resource (Tenant B), which resolves to a different, nonexistent _uuid and
        // masks the exploit by accident. A caller who has learned patA's real uuid (e.g. via any
        // of the other IDG-class UUID-disclosure gaps already documented) is the realistic attacker
        // this chain describes.
        const patAUuid = uuidOf(mergeResp.body, 'patA');

        const tenantBHeaders = getHeaders('user/*.read user/*.write access/tenant_b.*');

        // Step 1: Tenant B self-grants a Consent it owns, referencing Tenant A's patient directly.
        const consentResp = await request
            .post('/4_0_0/Consent/$merge')
            .send(selfGrantedConsent('consentB', 'tenant_b', `Patient/${patAUuid}`))
            .set(tenantBHeaders);

        // Step 2: Tenant B grafts a Person.link from its own Person to Tenant A's patient.
        const linkResp = await request
            .post('/4_0_0/Person/$merge')
            .send(person('personB', 'tenant_b', ['Patient/patB', `Patient/${patAUuid}`]))
            .set(tenantBHeaders);

        // Step 3: Tenant B reads $everything via the proxy-patient form of its own Person.
        const everythingResp = await request
            .get(`/4_0_0/Patient/person.${personBUuid}/$everything`)
            .set(tenantBHeaders);

        const returnedSourceIds = (everythingResp.body.entry || [])
            .map(e => e.resource?.identifier?.find(i => i.system === 'https://www.icanbwell.com/sourceId')?.value);

        // PASS condition: either an earlier step was rejected (4xx), or Tenant A's data never
        // appears in the $everything bundle.
        const anEarlierWriteWasRejected = consentResp.statusCode >= 400 || linkResp.statusCode >= 400;
        const tenantADataLeaked = returnedSourceIds.includes('patA') || returnedSourceIds.includes('obsA');

        expect(anEarlierWriteWasRejected || !tenantADataLeaked).toBe(true);
    });

    test('control: a legitimate self-granted consent for Tenant B\'s own already-linked patient still works', async () => {
        const request = await createTestRequest();

        // Tenant B's own PROA-connected patient, already linked from Tenant B's Person from the
        // start -- no link graft involved. This must keep working; the eventual fix must not
        // overcorrect into rejecting all self-granted consent.
        const patBProa = patient('patBProa', 'tenant_b', { connectionType: 'proa' });
        const obsBProa = observation('obsBProa', 'tenant_b', 'patBProa');
        const patB = patient('patB', 'tenant_b');
        const personB = person('personB', 'tenant_b', ['Patient/patB', 'Patient/patBProa']);

        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([patBProa, obsBProa, patB, personB])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });
        const personBUuid = uuidOf(mergeResp.body, 'personB');

        const tenantBHeaders = getHeaders('user/*.read user/*.write access/tenant_b.*');

        const consentResp = await request
            .post('/4_0_0/Consent/$merge')
            .send(selfGrantedConsent('consentBLegit', 'tenant_b', 'Patient/patBProa'))
            .set(tenantBHeaders);
        expect(consentResp).toHaveMergeResponse({ created: true });

        const everythingResp = await request
            .get(`/4_0_0/Patient/person.${personBUuid}/$everything`)
            .set(tenantBHeaders);

        const returnedSourceIds = (everythingResp.body.entry || [])
            .map(e => e.resource?.identifier?.find(i => i.system === 'https://www.icanbwell.com/sourceId')?.value);
        expect(returnedSourceIds).toContain('obsBProa');
    });
});

describe('SEC-1580 W1: consent self-grant in isolation, without the link graft (Task 1.2)', () => {
    const cursorSpy = jest.spyOn(DatabaseCursor.prototype, 'hint');

    beforeEach(async () => {
        cursorSpy.mockReturnThis();
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('a self-granted consent referencing a patient never linked from the caller\'s Person leaks nothing via $everything', async () => {
        const request = await createTestRequest();

        const patA = patient('patA', 'tenant_a', { connectionType: 'proa' });
        const obsA = observation('obsA', 'tenant_a', 'patA');
        const patB = patient('patB', 'tenant_b');
        // Tenant B's Person links ONLY to its own patient -- no graft to patA at all.
        const personB = person('personB', 'tenant_b', ['Patient/patB']);

        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([patA, obsA, patB, personB])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });
        const personBUuid = uuidOf(mergeResp.body, 'personB');
        const patAUuid = uuidOf(mergeResp.body, 'patA');

        const tenantBHeaders = getHeaders('user/*.read user/*.write access/tenant_b.*');

        const consentResp = await request
            .post('/4_0_0/Consent/$merge')
            .send(selfGrantedConsent('consentB', 'tenant_b', `Patient/${patAUuid}`))
            .set(tenantBHeaders);

        const everythingResp = await request
            .get(`/4_0_0/Patient/person.${personBUuid}/$everything`)
            .set(tenantBHeaders);

        const returnedSourceIds = (everythingResp.body.entry || [])
            .map(e => e.resource?.identifier?.find(i => i.system === 'https://www.icanbwell.com/sourceId')?.value);

        const writeWasRejected = consentResp.statusCode >= 400;
        const tenantADataLeaked = returnedSourceIds.includes('patA') || returnedSourceIds.includes('obsA');

        // This isolates the bug from W-chain: if this passes but Task 1.1's W-chain test fails,
        // the fix belongs in the link-write path (Person.link), not the consent-write path.
        expect(writeWasRejected || !tenantADataLeaked).toBe(true);
    });
});
