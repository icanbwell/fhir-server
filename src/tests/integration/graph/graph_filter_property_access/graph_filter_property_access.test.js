const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const ACCESS_SYSTEM = 'https://www.icanbwell.com/access';
const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';

const TENANT_A_SCOPE = 'user/*.read user/*.write access/tenantA.*';

function metaFor(tenant) {
    return {
        source: 'http://example.org/test',
        security: [
            { system: OWNER_SYSTEM, code: tenant },
            { system: ACCESS_SYSTEM, code: tenant }
        ]
    };
}

const patientTenantA = {
    resourceType: 'Patient',
    id: 'patient-a',
    meta: metaFor('tenantA'),
    gender: 'female'
};

const patientTenantB = {
    resourceType: 'Patient',
    id: 'patient-b',
    meta: metaFor('tenantB'),
    gender: 'male'
};

const observationReferencingTenantB = {
    resourceType: 'Observation',
    id: 'obs-cross',
    meta: metaFor('tenantA'),
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
    subject: { reference: 'Patient/patient-b' }
};

const observationReferencingTenantA = {
    resourceType: 'Observation',
    id: 'obs-same',
    meta: metaFor('tenantA'),
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
    subject: { reference: 'Patient/patient-a' }
};

function graphDefinition({ path, params }) {
    const target = { type: 'Patient' };
    if (params !== undefined) {
        target.params = params;
    }
    return {
        resourceType: 'GraphDefinition',
        id: 'subject-graph',
        name: 'subject-graph',
        status: 'active',
        start: 'Observation',
        link: [
            {
                description: 'Subject patient',
                path,
                target: [target]
            }
        ]
    };
}

function patientIdsIn(bundle) {
    return (bundle.entry || [])
        .map((e) => e.resource)
        .filter((r) => r && r.resourceType === 'Patient')
        .map((r) => r.id);
}

describe('$graph GraphDefinition link.path filter and target.params', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    async function seed(request) {
        for (const resource of [
            patientTenantA,
            patientTenantB,
            observationReferencingTenantA,
            observationReferencingTenantB
        ]) {
            const resp = await request
                .post(`/4_0_0/${resource.resourceType}/${resource.id}/$merge`)
                .send(resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        }
    }

    async function graphPatients(request, observationId, { path, params }) {
        const resp = await request
            .post(`/4_0_0/Observation/${observationId}/$graph`)
            .send(graphDefinition({ path, params }))
            .set(getHeaders(TENANT_A_SCOPE));
        expect(resp.status).toBe(200);
        return patientIdsIn(resp.body);
    }

    describe('tenant isolation holds for every form of filter', () => {
        test('POSITIVE CONTROL: a tenantA caller reaches its own tenant patient through $graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(await graphPatients(request, 'obs-same', { path: 'subject' })).toContain('patient-a');
        });

        test('a tenantA caller does not reach a tenantB patient through an unmodified link', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(await graphPatients(request, 'obs-cross', { path: 'subject' })).not.toContain(
                'patient-b'
            );
        });

        test('a link.path filter naming meta.security does not expose a tenantB patient', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-cross', { path: 'subject:meta.security=tenantB' })
            ).not.toContain('patient-b');
        });

        test('a link.path filter naming _security does not expose a tenantB patient', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-cross', { path: 'subject:_security=tenantB' })
            ).not.toContain('patient-b');
        });

        test('a link.path filter naming id does not expose a tenantB patient', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-cross', { path: 'subject:id=patient-b' })
            ).not.toContain('patient-b');
        });

        test('a target.params _security naming the other tenant does not expose a tenantB patient', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-cross', {
                    path: 'subject',
                    params: `_security=${ACCESS_SYSTEM}|tenantB`
                })
            ).not.toContain('patient-b');
        });
    });

    describe('a link.path filter naming a key the guard rejects leaves the graph identical to no filter', () => {
        test('_security in a link.path leaves the graph identical to no filter', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphPatients(request, 'obs-same', { path: 'subject' });

            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:_security=tenantA' })
            ).toEqual(baseline);
            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:_security=tenantB' })
            ).toEqual(baseline);
        });

        test('a Mongo operator key in a link.path leaves the graph identical to no filter', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphPatients(request, 'obs-same', { path: 'subject' });

            expect(await graphPatients(request, 'obs-same', { path: 'subject:$where=1' })).toEqual(
                baseline
            );
            expect(await graphPatients(request, 'obs-same', { path: 'subject:$and=1' })).toEqual(
                baseline
            );
        });

        test('an internal access field name in a link.path leaves the graph identical to no filter', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphPatients(request, 'obs-same', { path: 'subject' });

            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:_access.tenantA=1' })
            ).toEqual(baseline);
            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:_access.tenantB=1' })
            ).toEqual(baseline);
        });

        test('__proto__ in a link.path leaves the graph intact and does not pollute Object.prototype', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphPatients(request, 'obs-same', { path: 'subject' });

            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:__proto__=polluted' })
            ).toEqual(baseline);
            expect({}.polluted).toBeUndefined();
            expect(Object.prototype.polluted).toBeUndefined();
        });
    });

    describe('a link.path filter naming a key the guard accepts is ANDed onto the target query', () => {
        test('meta.security in a link.path empties the graph instead of filtering the target', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(await graphPatients(request, 'obs-same', { path: 'subject' })).toContain('patient-a');

            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:meta.security=tenantA' })
            ).toEqual([]);
            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:meta.security=tenantB' })
            ).toEqual([]);
        });

        test('id in a link.path narrows the reference-derived id list but cannot replace it', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-same', { path: 'subject:id=patient-a' })
            ).toEqual(['patient-a']);
            expect(await graphPatients(request, 'obs-same', { path: 'subject:id=patient-b' })).toEqual(
                []
            );
            expect(await graphPatients(request, 'obs-cross', { path: 'subject:id=patient-a' })).toEqual(
                []
            );
        });
    });

    describe('target.params is the documented way to filter a forward-reference target', () => {
        test('_security as system|code matching the resource keeps it in the graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-same', {
                    path: 'subject',
                    params: `_security=${ACCESS_SYSTEM}|tenantA`
                })
            ).toContain('patient-a');
        });

        test('_security as system|code the resource does not carry removes it from the graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(await graphPatients(request, 'obs-same', { path: 'subject' })).toContain('patient-a');
            expect(
                await graphPatients(request, 'obs-same', {
                    path: 'subject',
                    params: `_security=${ACCESS_SYSTEM}|tenantB`
                })
            ).not.toContain('patient-a');
        });

        test('_security as a bare code matching the resource keeps it in the graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-same', {
                    path: 'subject',
                    params: '_security=tenantA'
                })
            ).toContain('patient-a');
        });

        test('_tag naming a tag the resource does not carry removes it from the graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphPatients(request, 'obs-same', {
                    path: 'subject',
                    params: '_tag=no-such-tag'
                })
            ).not.toContain('patient-a');
        });

        test('meta.security is not a FHIR search parameter, so it is ignored in target.params', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphPatients(request, 'obs-same', { path: 'subject' });

            expect(
                await graphPatients(request, 'obs-same', {
                    path: 'subject',
                    params: 'meta.security=tenantA'
                })
            ).toEqual(baseline);
            expect(
                await graphPatients(request, 'obs-same', {
                    path: 'subject',
                    params: 'meta.security=tenantB'
                })
            ).toEqual(baseline);
        });

        test('a Mongo operator key is ignored in target.params', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphPatients(request, 'obs-same', { path: 'subject' });

            expect(
                await graphPatients(request, 'obs-same', { path: 'subject', params: '$where=1' })
            ).toEqual(baseline);
        });

        test('target.params cannot replace the reference-derived id list', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphPatients(request, 'obs-same', { path: 'subject' });

            expect(
                await graphPatients(request, 'obs-same', { path: 'subject', params: 'id=patient-b' })
            ).toEqual(baseline);
            expect(
                await graphPatients(request, 'obs-cross', { path: 'subject', params: 'id=patient-a' })
            ).not.toContain('patient-a');
        });
    });
});
