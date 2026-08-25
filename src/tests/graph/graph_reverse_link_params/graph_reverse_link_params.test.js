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

function patient(id, tenant) {
    return { resourceType: 'Patient', id, meta: metaFor(tenant), gender: 'female' };
}

function observation(id, tenant, subjectId) {
    return {
        resourceType: 'Observation',
        id,
        meta: metaFor(tenant),
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
        subject: { reference: `Patient/${subjectId}` }
    };
}

const RESOURCES = [
    patient('patient-a', 'tenantA'),
    patient('patient-c', 'tenantA'),
    patient('patient-b', 'tenantB'),
    observation('obs-a1', 'tenantA', 'patient-a'),
    observation('obs-c1', 'tenantA', 'patient-c'),
    observation('obs-b1', 'tenantB', 'patient-b')
];

function reverseGraph(params) {
    return {
        resourceType: 'GraphDefinition',
        id: 'rev-graph',
        name: 'rev-graph',
        status: 'active',
        start: 'Patient',
        link: [
            {
                description: 'Observations for this Patient',
                target: [{ type: 'Observation', params }]
            }
        ]
    };
}

function observationIdsIn(bundle) {
    return (bundle.entry || [])
        .map((e) => e.resource)
        .filter((r) => r && r.resourceType === 'Observation')
        .map((r) => r.id)
        .sort();
}

describe('$graph reverse link target.params', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    async function seed(request) {
        for (const resource of RESOURCES) {
            const resp = await request
                .post(`/4_0_0/${resource.resourceType}/${resource.id}/$merge`)
                .send(resource)
                .set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        }
    }

    async function graphObservations(request, patientId, params) {
        const resp = await request
            .post(`/4_0_0/Patient/${patientId}/$graph`)
            .send(reverseGraph(params))
            .set(getHeaders(TENANT_A_SCOPE));
        expect(resp.status).toBe(200);
        return observationIdsIn(resp.body);
    }

    describe('the reverse linkage itself is authoritative', () => {
        test('POSITIVE CONTROL: a reverse link returns only the observations referencing this patient', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(await graphObservations(request, 'patient-a', 'subject={ref}')).toEqual(['obs-a1']);
        });

        test('the {id} placeholder form resolves the same way', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(await graphObservations(request, 'patient-a', 'subject={id}')).toEqual(['obs-a1']);
        });

        test('a hardcoded subject naming another tenant returns nothing', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphObservations(request, 'patient-a', 'subject=Patient/patient-b')
            ).toEqual([]);
        });

        test('a hardcoded subject naming a readable but unlinked same-tenant patient returns nothing', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphObservations(request, 'patient-a', 'subject=Patient/patient-c')
            ).toEqual([]);
        });

        test('omitting the placeholder entirely fails closed rather than returning every readable resource', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(await graphObservations(request, 'patient-a', '_security=tenantA')).toEqual([]);
        });
    });

    describe('a real FHIR search parameter in a reverse target.params is applied', () => {
        test('_security matching the resource keeps it in the graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&_security=tenantA')
            ).toEqual(['obs-a1']);
        });

        test('_security naming a tenant the resource does not carry removes it from the graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphObservations(request, 'patient-a', `subject={ref}&_security=${ACCESS_SYSTEM}|tenantB`)
            ).toEqual([]);
        });

        test('status naming a value the resource does not carry removes it from the graph', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&status=cancelled')
            ).toEqual([]);
        });
    });

    describe('the first parameter in target.params is the one treated as the link', () => {
        test('a matching _security placed before the placeholder returns nothing', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphObservations(request, 'patient-a', `subject={ref}&_security=${ACCESS_SYSTEM}|tenantA`)
            ).toEqual(['obs-a1']);
            expect(
                await graphObservations(request, 'patient-a', `_security=${ACCESS_SYSTEM}|tenantA&subject={ref}`)
            ).toEqual([]);
        });

        test('a matching status placed before the placeholder returns nothing', async () => {
            const request = await createTestRequest();
            await seed(request);

            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&status=final')
            ).toEqual(['obs-a1']);
            expect(
                await graphObservations(request, 'patient-a', 'status=final&subject={ref}')
            ).toEqual([]);
        });
    });

    describe('a name that is not a FHIR search parameter is ignored, not applied', () => {
        test('meta.security is ignored, so both values give the unfiltered result', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphObservations(request, 'patient-a', 'subject={ref}');
            expect(baseline).toEqual(['obs-a1']);

            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&meta.security=tenantA')
            ).toEqual(baseline);
            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&meta.security=tenantB')
            ).toEqual(baseline);
        });

        test('a Mongo operator key is ignored', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphObservations(request, 'patient-a', 'subject={ref}');

            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&$where=1')
            ).toEqual(baseline);
            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&$and=1')
            ).toEqual(baseline);
        });

        test('an internal access field name is ignored', async () => {
            const request = await createTestRequest();
            await seed(request);

            const baseline = await graphObservations(request, 'patient-a', 'subject={ref}');

            expect(
                await graphObservations(request, 'patient-a', 'subject={ref}&_access.tenantB=1')
            ).toEqual(baseline);
        });
    });
});
