const claimResource = require('./fixtures/claim/explanation_of_benefits.json');
const practitionerResource = require('./fixtures/claim/practitioner.json');
const organizationResource = require('./fixtures/claim/organization.json');
const graphDefinitionResource = require('./fixtures/graph/my_graph.json');
const patientClientP1Resource = require('../graph_delete/fixtures/Patient/patient_clientp1.json');
const observationProaLinkedToClientP1Resource = require('../graph_delete/fixtures/Observation/observation_proa_linked_to_clientp1.json');
const graphPatientToObservation = require('../graph_delete/fixtures/graph/graph_patient_to_observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AuditLogger } = require('../../../../utils/auditLogger');

describe('$graph read audit', () => {
    let request;
    let auditLogger;
    let postRequestProcessor;
    let auditEventCollection;

    beforeEach(async () => {
        await commonBeforeEach();
        request = await createTestRequest((container) => {
            container.register(
                'auditLogger',
                (c) =>
                    new AuditLogger({
                        postRequestProcessor: c.postRequestProcessor,
                        databaseBulkInserter: c.fastDatabaseBulkInserter,
                        preSaveManager: c.preSaveManager,
                        configManager: c.configManager
                    })
            );
            return container;
        });
        const container = getTestContainer();
        auditLogger = container.auditLogger;
        postRequestProcessor = container.postRequestProcessor;
        const auditEventDb = await container.mongoDatabaseManager.getAuditDbAsync();
        auditEventCollection = auditEventDb.collection('AuditEvent_4_0_0');

        for (const [path, body] of [
            ['Practitioner/1376656959', practitionerResource],
            ['Organization/1407857790', organizationResource],
            ['ExplanationOfBenefit/WPS-Claim-230916613368', claimResource[1]]
        ]) {
            const resp = await request.post(`/4_0_0/${path}/$merge`).send(body).set(getHeaders());
            expect(resp).toHaveMergeResponse({ created: true });
        }
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const readAuditLogsAsync = async () => {
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 10 });
        await auditLogger.flushAsync();
        return await auditEventCollection.find({ action: 'R' }).toArray();
    };

    /**
     * For asserting that nothing is written: nothing can be polled for, so give a queued task time to land
     * @returns {Promise<Object[]>}
     */
    const getReadAuditLogsAfterSettlingAsync = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await readAuditLogsAsync();
    };

    /**
     * waitTillAllRequestsDoneAsync returns before the last post-request task finishes, so poll until the
     * expected references have been written (or the deadline passes, and the assertion shows the difference).
     * Then settle and read once more, so an extra entry queued after the expected ones is still seen.
     * @param {string[]} expectedReferences
     * @returns {Promise<Object[]>}
     */
    const getReadAuditLogsAsync = async (expectedReferences) => {
        const deadline = Date.now() + 15000;
        let auditLogs = await readAuditLogsAsync();
        while (
            getAuditedReferences(auditLogs).length < expectedReferences.length &&
            Date.now() < deadline
        ) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            auditLogs = await readAuditLogsAsync();
        }
        return await getReadAuditLogsAfterSettlingAsync();
    };

    /**
     * The Type/uuid references of every resource in a $graph response, contained resources included
     * @param {Object} body
     * @returns {string[]}
     */
    const getReturnedReferences = (body) => {
        const collect = (resource) => [
            `${resource.resourceType}/${
                resource.identifier.find((i) => i.system.endsWith('/uuid')).value
            }`,
            ...(resource.contained || []).flatMap(collect)
        ];
        return body.entry.flatMap((e) => collect(e.resource)).sort();
    };

    const getAuditedReferences = (auditLogs) =>
        auditLogs.flatMap((log) => log.entity.map((e) => e.what.reference)).sort();

    test.each([
        ['contained=true', '?contained=true'],
        ['contained=false', '']
    ])('POST $graph (%s) writes a read AuditEvent for every resource type returned', async (_, query) => {
        await auditEventCollection.deleteMany({});

        const resp = await request
            .post(`/4_0_0/ExplanationOfBenefit/WPS-Claim-230916613368/$graph${query}`)
            .set(getHeaders())
            .send(graphDefinitionResource);
        expect(resp).toHaveStatusCode(200);

        const returnedReferences = getReturnedReferences(resp.body);
        expect(returnedReferences.map((r) => r.split('/')[0])).toEqual([
            'ExplanationOfBenefit',
            'Practitioner'
        ]);
        expect(getAuditedReferences(await getReadAuditLogsAsync(returnedReferences))).toEqual(
            returnedReferences
        );
    });

    test('POST $graph on a missing resource writes no AuditEvent', async () => {
        await auditEventCollection.deleteMany({});

        const resp = await request
            .post('/4_0_0/ExplanationOfBenefit/does-not-exist/$graph')
            .set(getHeaders())
            .send(graphDefinitionResource);
        expect(resp).toHaveStatusCode(200);

        expect(await getReadAuditLogsAfterSettlingAsync()).toHaveLength(0);
    });

    test('POST $graph audits only the resources the caller can read, not other tenants resources', async () => {
        for (const [path, body] of [
            ['Patient/1', patientClientP1Resource],
            ['Observation/1', observationProaLinkedToClientP1Resource]
        ]) {
            const merged = await request.post(`/4_0_0/${path}/$merge`).send(body).set(getHeaders());
            expect(merged).toHaveMergeResponse({ created: true });
        }
        await auditEventCollection.deleteMany({});

        const resp = await request
            .post('/4_0_0/Patient/patient-clientp1/$graph')
            .set(getHeaders('user/*.read access/client-p1.read'))
            .send(graphPatientToObservation);
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry.map((e) => e.resource.resourceType)).toEqual(['Patient']);

        const returnedReferences = getReturnedReferences(resp.body);
        expect(returnedReferences).toHaveLength(1);
        expect(getAuditedReferences(await getReadAuditLogsAsync(returnedReferences))).toEqual(
            returnedReferences
        );
    });

    test.each([
        ['contained=true', '&contained=true'],
        ['contained=false', '']
    ])('POST $graph (%s) audits a resource shared by several returned resources once, with its id', async (_, query) => {
        const security = [
            { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
            { system: 'https://www.icanbwell.com/access', code: 'bwell' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }
        ];
        const sharedPractitioner = {
            resourceType: 'Practitioner',
            id: 'shared-practitioner',
            meta: { source: 'test', security },
            name: [{ family: 'Shared' }]
        };
        const patients = ['shared-patient-1', 'shared-patient-2'].map((id) => ({
            resourceType: 'Patient',
            id,
            meta: { source: 'test', security },
            generalPractitioner: [{ reference: 'Practitioner/shared-practitioner' }]
        }));
        for (const resource of [sharedPractitioner, ...patients]) {
            const merged = await request
                .post(`/4_0_0/${resource.resourceType}/1/$merge`)
                .send(resource)
                .set(getHeaders());
            expect(merged).toHaveMergeResponse({ created: true });
        }
        await auditEventCollection.deleteMany({});

        const resp = await request
            .post(`/4_0_0/Patient/$graph?id=shared-patient-1,shared-patient-2${query}`)
            .set(getHeaders())
            .send({
                resourceType: 'GraphDefinition',
                id: 'patient-to-practitioner',
                name: 'patient_to_practitioner',
                status: 'active',
                start: 'Patient',
                link: [{ path: 'generalPractitioner', target: [{ type: 'Practitioner' }] }]
            });
        expect(resp).toHaveStatusCode(200);

        const expectedReferences = [...new Set(getReturnedReferences(resp.body))].sort();
        const auditedReferences = getAuditedReferences(await getReadAuditLogsAsync(expectedReferences));
        expect(auditedReferences.filter((r) => r.endsWith('undefined'))).toEqual([]);
        expect(auditedReferences).toEqual(expectedReferences);
    });

    test.each([
        ['contained=true', '?contained=true'],
        ['contained=false', '']
    ])('POST $graph (%s) does not audit an id planted inside a stored contained element', async (_, query) => {
        const security = [
            { system: 'https://www.icanbwell.com/owner', code: 'bwell' },
            { system: 'https://www.icanbwell.com/access', code: 'bwell' },
            { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'bwell' }
        ];
        for (const resource of [
            { resourceType: 'Organization', id: 'forge-victim' },
            {
                resourceType: 'Patient',
                id: 'forge-host',
                managingOrganization: { reference: 'Organization/forge-victim' }
            }
        ]) {
            const merged = await request
                .post(`/4_0_0/${resource.resourceType}/1/$merge`)
                .send({ ...resource, meta: { source: 'test', security } })
                .set(getHeaders());
            expect(merged).toHaveMergeResponse({ created: true });
        }
        const victim = await request.get('/4_0_0/Organization/forge-victim').set(getHeaders());
        const victimUuid = victim.body.identifier.find((i) => i.system.endsWith('/uuid')).value;

        // PATCH refuses a _uuid in an operation value, but a copy of a stored reference carries its _uuid
        // into contained, where it is stored as given
        const patched = await request
            .patch('/4_0_0/Patient/forge-host')
            .send([
                { op: 'add', path: '/contained', value: [] },
                { op: 'copy', from: '/managingOrganization', path: '/contained/-' },
                { op: 'remove', path: '/contained/0/reference' },
                { op: 'add', path: '/contained/0/resourceType', value: 'Organization' },
                { op: 'add', path: '/contained/0/id', value: 'planted' },
                { op: 'add', path: '/link', value: [{ other: { reference: '#planted' }, type: 'seealso' }] }
            ])
            .set(getHeadersJsonPatch());
        expect(patched).toHaveStatusCode(200);
        // the GET above queued its own read audit: let it land before clearing, so it is not mistaken for ours
        await getReadAuditLogsAfterSettlingAsync();
        await auditEventCollection.deleteMany({});

        const resp = await request
            .post(`/4_0_0/Patient/forge-host/$graph${query}`)
            .set(getHeaders())
            .send(graphPatientToObservation);
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.entry[0].resource.contained).toHaveLength(1);

        const returnedReferences = getReturnedReferences({
            entry: resp.body.entry.map((e) => ({ resource: { ...e.resource, contained: undefined } }))
        });
        const auditedReferences = getAuditedReferences(await getReadAuditLogsAsync(returnedReferences));
        expect(auditedReferences).toEqual(returnedReferences);
        expect(auditedReferences.join(',')).not.toContain(victimUuid);
    });
});
