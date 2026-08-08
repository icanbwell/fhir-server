/**
 * IDG-5. Target state: every resource surfaced through $everything/$graph reference expansion
 * gets the same access-tag check it would get if fetched directly, not only the resources reached
 * via the direct patient graph.
 *
 * Scenario (E.3): Patient/Observation are owned by tenantA. The Observation's `performer`
 * references a Practitioner owned (and access-tagged) ONLY by tenantB -- no relationship to
 * tenantA at all. A tenantA-only caller's $everything/$graph on the Patient walks the Observation
 * (same tenant, permitted) and then follows `performer` to fetch the Practitioner, which is a
 * forward-reference expansion rather than the direct patient graph. The required behavior is that
 * this fetch carries its own access-tag check, so reachability via a reference never substitutes
 * for authorization.
 *
 * Contrast with src/tests/everything/delete_person_or_patient/delete_everything_cross_tag.test.js:
 * that file proves a foreign-tagged resource on the DIRECT patient graph can't be deleted via
 * $everything. This file is about (a) a resource reached via forward-reference expansion, not the
 * direct graph, and (b) a GET, not a DELETE.
 */
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const OWNER = 'https://www.icanbwell.com/owner';
const ACCESS = 'https://www.icanbwell.com/access';

function taggedResource (base, ownerCode, accessCodes = [ownerCode]) {
    return {
        ...base,
        meta: {
            ...(base.meta || {}),
            source: ownerCode,
            security: [
                { system: OWNER, code: ownerCode },
                ...accessCodes.map(code => ({ system: ACCESS, code }))
            ]
        }
    };
}

function patient (id, ownerCode) {
    return taggedResource({
        resourceType: 'Patient',
        id,
        birthDate: '2017-01-01',
        gender: 'female',
        name: [{ use: 'usual', family: 'TEST', given: ['TEST'] }]
    }, ownerCode);
}

function practitioner (id, ownerCode, accessCodes) {
    return taggedResource({
        resourceType: 'Practitioner',
        id,
        name: [{ use: 'usual', family: 'DOC', given: ['DOC'] }]
    }, ownerCode, accessCodes);
}

function observationWithPerformer (id, ownerCode, patientId, practitionerId) {
    return taggedResource({
        resourceType: 'Observation',
        id,
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
        subject: { reference: `Patient/${patientId}` },
        performer: [{ reference: `Practitioner/${practitionerId}` }]
    }, ownerCode);
}

describe('IDG-5: a resource reached only by reference expansion must still pass the access-tag check', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('$everything on a tenantA patient must not include a tenantB-only Practitioner reached via Observation.performer', async () => {
        const request = await createTestRequest();

        const patA = patient('patA', 'tenant_a');
        const obsA = observationWithPerformer('obsA', 'tenant_a', 'patA', 'practB');
        // owned AND access-tagged only by tenant_b -- no relationship to tenant_a at all
        const practB = practitioner('practB', 'tenant_b', ['tenant_b']);

        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([patA, obsA, practB])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const tenantAHeaders = getHeaders('user/*.read access/tenant_a.*');

        const everythingResp = await request
            .get('/4_0_0/Patient/patA/$everything')
            .set(tenantAHeaders);

        // Guard against this test passing vacuously (e.g. a 403 or an empty/error Bundle would
        // also satisfy the not.toContain check below without proving anything was enforced).
        expect(everythingResp.status).toBe(200);

        const returnedSourceIds = (everythingResp.body.entry || [])
            .map(e => e.resource?.identifier?.find(i => i.system === 'https://www.icanbwell.com/sourceId')?.value);

        expect(returnedSourceIds).toContain('patA');
        expect(returnedSourceIds).toContain('obsA');
        expect(returnedSourceIds).not.toContain('practB');
    });

    test('control: $everything on a tenantA patient DOES include a Practitioner the caller has access to', async () => {
        const request = await createTestRequest();

        const patA = patient('patA', 'tenant_a');
        const obsA = observationWithPerformer('obsA', 'tenant_a', 'patA', 'practA');
        const practA = practitioner('practA', 'tenant_a', ['tenant_a']);

        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([patA, obsA, practA])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const tenantAHeaders = getHeaders('user/*.read access/tenant_a.*');

        const everythingResp = await request
            .get('/4_0_0/Patient/patA/$everything')
            .set(tenantAHeaders);

        const returnedSourceIds = (everythingResp.body.entry || [])
            .map(e => e.resource?.identifier?.find(i => i.system === 'https://www.icanbwell.com/sourceId')?.value);

        expect(returnedSourceIds).toContain('practA');
    });

    test('$graph on a tenantA patient must not include a tenantB-only Practitioner reached via Observation.performer', async () => {
        const request = await createTestRequest();

        const patA = patient('patA2', 'tenant_a');
        const obsA = observationWithPerformer('obsA2', 'tenant_a', 'patA2', 'practB2');
        const practB = practitioner('practB2', 'tenant_b', ['tenant_b']);
        // Same-tenant sibling under a second Observation, so a status/empty-response regression
        // can't make the not.toContain assertion below pass vacuously -- something must actually
        // be returned, and it must be the right thing.
        const obsA2 = observationWithPerformer('obsA2b', 'tenant_a', 'patA2', 'practA2');
        const practA = practitioner('practA2', 'tenant_a', ['tenant_a']);

        const mergeResp = await request
            .post('/4_0_0/Patient/1/$merge')
            .send([patA, obsA, practB, obsA2, practA])
            .set(getHeaders());
        expect(mergeResp).toHaveMergeResponse({ created: true });

        const tenantAHeaders = getHeaders('user/*.read access/tenant_a.*');

        const graphDefinition = {
            resourceType: 'GraphDefinition',
            id: 'test-graph',
            name: 'test-graph',
            status: 'active',
            start: 'Patient',
            link: [{
                target: [{
                    type: 'Observation',
                    params: 'patient={ref}',
                    link: [{
                        path: 'performer',
                        target: [{ type: 'Practitioner' }]
                    }]
                }]
            }]
        };

        const graphResp = await request
            .post('/4_0_0/Patient/patA2/$graph')
            .send(graphDefinition)
            .set(tenantAHeaders);

        // Guard against this test passing vacuously (e.g. a 403 or an error OperationOutcome
        // would also satisfy the not.toContain check below without proving anything was enforced).
        expect(graphResp.status).toBe(200);

        // Check actual returned resources by sourceId rather than doing a raw substring search
        // over the whole response body: the same-tenant Observation legitimately still carries
        // a `performer` *reference* to Practitioner/practB2 (referential integrity for an
        // excluded resource), so a bodyText.not.toContain('practB2') check would false-fail on
        // that reference string even when the Practitioner resource itself is correctly excluded.
        const returnedSourceIds = (graphResp.body.entry || [])
            .map(e => e.resource?.identifier?.find(i => i.system === 'https://www.icanbwell.com/sourceId')?.value);

        expect(returnedSourceIds).toContain('practA2');
        expect(returnedSourceIds).not.toContain('practB2');
    });
});
