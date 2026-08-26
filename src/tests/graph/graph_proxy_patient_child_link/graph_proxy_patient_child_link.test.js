const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const ACCESS_SYSTEM = 'https://www.icanbwell.com/access';
const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';

function metaFor(tenant) {
    return {
        source: 'http://example.org/test',
        security: [
            { system: OWNER_SYSTEM, code: tenant },
            { system: ACCESS_SYSTEM, code: tenant }
        ]
    };
}

const patientResource = {
    resourceType: 'Patient',
    id: 'patient-1',
    meta: metaFor('tenantA'),
    gender: 'female'
};

const personResource = {
    resourceType: 'Person',
    id: 'person-1',
    meta: metaFor('tenantA'),
    link: [{ target: { reference: 'Patient/patient-1' } }]
};

function observationWithSubject(reference, id = 'obs-1') {
    return {
        resourceType: 'Observation',
        id,
        meta: metaFor('tenantA'),
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '1234-5' }] },
        subject: { reference }
    };
}

const reverseObservationGraph = {
    resourceType: 'GraphDefinition',
    id: 'rev-graph',
    name: 'rev-graph',
    status: 'active',
    start: 'Patient',
    link: [
        {
            description: 'Observations for this patient',
            target: [{ type: 'Observation', params: 'subject={ref}' }]
        }
    ]
};

function observationIdsIn(bundle) {
    return (bundle.entry || [])
        .map((e) => e.resource)
        .filter((r) => r && r.resourceType === 'Observation')
        .map((r) => r.id)
        .sort();
}

const subjectGraph = {
    resourceType: 'GraphDefinition',
    id: 'subject-graph',
    name: 'subject-graph',
    status: 'active',
    start: 'Observation',
    link: [
        {
            description: 'Subject patient',
            path: 'subject',
            target: [{ type: 'Patient' }]
        }
    ]
};

function patientIdsIn(bundle) {
    return (bundle.entry || [])
        .map((e) => e.resource)
        .filter((r) => r && r.resourceType === 'Patient')
        .map((r) => r.id);
}

async function merge(request, resource) {
    const resp = await request
        .post(`/4_0_0/${resource.resourceType}/${resource.id}/$merge`)
        .send(resource)
        .set(getHeaders());
    expect(resp).toHaveMergeResponse({ created: true });
    return resp;
}

describe('$graph child link with a proxy-patient subject reference', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('POSITIVE CONTROL: a direct Patient subject reference is returned by $graph', async () => {
        const request = await createTestRequest();
        await merge(request, patientResource);
        await merge(request, personResource);
        await merge(request, observationWithSubject('Patient/patient-1'));

        const resp = await request
            .post('/4_0_0/Observation/obs-1/$graph')
            .send(subjectGraph)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(patientIdsIn(resp.body)).toContain('patient-1');
    });

    describe('a forward child link does not expand a proxy-patient reference', () => {
        test('a proxy-patient subject reference is followed literally and reaches no Patient', async () => {
            const request = await createTestRequest();
            await merge(request, patientResource);
            const personResp = await merge(request, personResource);
            expect(personResp.body.uuid).toBeTruthy();
            await merge(
                request,
                observationWithSubject(`Patient/person.${personResp.body.uuid}`)
            );

            const resp = await request
                .post('/4_0_0/Observation/obs-1/$graph')
                .send(subjectGraph)
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(patientIdsIn(resp.body)).toEqual([]);
        });
    });

    describe('a reverse link started at a proxy patient id does expand the proxy', () => {
        async function seedBoth(request) {
            await merge(request, patientResource);
            const personResp = await merge(request, personResource);
            expect(personResp.body.uuid).toBeTruthy();
            await merge(
                request,
                observationWithSubject(`Patient/person.${personResp.body.uuid}`, 'obs-proxy')
            );
            await merge(request, observationWithSubject('Patient/patient-1', 'obs-real'));
            return personResp.body.uuid;
        }

        test('starting at Patient/person.<uuid> reaches both the proxy-referencing and the directly-referencing observation', async () => {
            const request = await createTestRequest();
            const personUuid = await seedBoth(request);

            const resp = await request
                .post(`/4_0_0/Patient/person.${personUuid}/$graph`)
                .send(reverseObservationGraph)
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(observationIdsIn(resp.body)).toEqual(['obs-proxy', 'obs-real']);
        });

        test('starting at the real Patient id reaches only the directly-referencing observation', async () => {
            const request = await createTestRequest();
            await seedBoth(request);

            const resp = await request
                .post('/4_0_0/Patient/patient-1/$graph')
                .send(reverseObservationGraph)
                .set(getHeaders());

            expect(resp.status).toBe(200);
            expect(observationIdsIn(resp.body)).toEqual(['obs-real']);
        });
    });
});
