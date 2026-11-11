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

    const getReadAuditLogsAsync = async () => {
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 10 });
        // the last post-request task is dequeued before it finishes, so give it time to queue its entry
        await new Promise((resolve) => setTimeout(resolve, 500));
        await auditLogger.flushAsync();
        return await auditEventCollection.find({ action: 'R' }).toArray();
    };

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

        const auditLogs = await getReadAuditLogsAsync();
        const referencedTypes = auditLogs
            .flatMap((log) => log.entity.map((e) => e.what.reference.split('/')[0]))
            .sort();
        expect(referencedTypes).toEqual(['ExplanationOfBenefit', 'Practitioner']);
    });

    test('POST $graph on a missing resource writes no AuditEvent', async () => {
        await auditEventCollection.deleteMany({});

        const resp = await request
            .post('/4_0_0/ExplanationOfBenefit/does-not-exist/$graph')
            .set(getHeaders())
            .send(graphDefinitionResource);
        expect(resp).toHaveStatusCode(200);

        expect(await getReadAuditLogsAsync()).toHaveLength(0);
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

        const auditLogs = await getReadAuditLogsAsync();
        const referencedTypes = auditLogs.flatMap((log) =>
            log.entity.map((e) => e.what.reference.split('/')[0])
        );
        expect(referencedTypes).toEqual(['Patient']);
    });
});
