// test file
const person1Resource = require('./fixtures/Person/person1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload,
    getTestContainer
} = require('../../common');
const { describe, beforeAll, beforeEach, afterAll, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAuditEventRows,
    getClickHouseManager
} = require('../../clickhouseOnly/accessHistory/accessHistoryTestSetup');
const { AccessHistoryClickHouseRepository } = require('../../../dataLayer/repositories/accessHistoryClickHouseRepository');
const { ConfigManager } = require('../../../utils/configManager');

class TestAccessHistoryConfigManager extends ConfigManager {
    get enableAccessAuditEvent() {
        return true;
    }

    get enableClickHouse() {
        return true;
    }

    get clickHouseOnlyResources() {
        return ['AuditEvent'];
    }
}

function toClickHouseDateTime(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '');
}

function daysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return toClickHouseDateTime(d);
}

describe('Person $access-history Tests', () => {
    let clickHouseRepository;
    let clickHouseManager;
    let sharedRequest;

    beforeAll(async () => {
        await setupAccessHistoryTests();
        clickHouseManager = getClickHouseManager();
        clickHouseRepository = new AccessHistoryClickHouseRepository({
            clickHouseClientManager: clickHouseManager
        });

        const { AuditLogger } = require('../../../utils/auditLogger');
        sharedRequest = await createTestRequest((c) => {
            c.register('configManager', () => new TestAccessHistoryConfigManager());
            c.register('accessHistoryClickHouseRepository', () => clickHouseRepository);
            c.register('auditLogger', (cont) => new AuditLogger({
                postRequestProcessor: cont.postRequestProcessor,
                databaseBulkInserter: cont.databaseBulkInserter,
                preSaveManager: cont.preSaveManager,
                configManager: cont.configManager
            }));
            return c;
        });
    }, 90000);

    beforeEach(async () => {
        await commonBeforeEach();
        await cleanupBetweenTests();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    afterAll(async () => {
        await teardownAccessHistoryTests();
    }, 30000);

    test('$access-history returns empty parameters when person has no linked patients', async () => {
        const request = sharedRequest;

        const personNoLinks = {
            ...person1Resource,
            id: 'personNoLinks',
            link: []
        };

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(personNoLinks)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Parameters');
        expect(resp.body.parameter).toEqual([]);
    });

    test('$access-history returns empty parameters when no access records exist', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Parameters');
        expect(resp.body.parameter).toEqual([]);
    });

    test('$access-history returns accessor details after a resource is read', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const patientUuid = resp.body.uuid;

        const accessorRef = 'Practitioner/dr-reader-uuid';
        const entityRef = `Patient/${patientUuid}`;
        await insertAuditEventRows([{
            id: 'ae-1',
            _uuid: 'ae-uuid-1',
            recorded: daysAgo(0),
            action: 'R',
            agent_who: [accessorRef],
            agent_altid: [],
            entity_what: [entityRef],
            agent_requestor_who: accessorRef
        }]);

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Parameters');
        expect(resp.body.parameter).toHaveLength(1);

        const accessor = resp.body.parameter[0];
        expect(accessor.name).toBe('accessor');

        const referencePart = accessor.part.find((p) => p.name === 'reference');
        expect(referencePart.valueReference.reference).toBe(accessorRef);

        const totalCountPart = accessor.part.find((p) => p.name === 'totalCount');
        expect(totalCountPart.valueInteger).toBe(1);

        const lastAccessedPart = accessor.part.find((p) => p.name === 'lastAccessed');
        expect(lastAccessedPart.valueDateTime).toBeDefined();
    });

    test('$access-history end-to-end: patient-scoped read populates access history via MV', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const patientUuid = resp.body.uuid;

        // Read with a patient-scoped token — this sets isUser=true, populating agent_requestor_who.
        // The bwellFhirPersonId must be a Person UUID that links to the Patient being read.
        resp = await request
            .get(`/4_0_0/Patient/${patientUuid}`)
            .set(
                getHeadersWithCustomPayload({
                    scope: 'patient/*.read user/*.read access/*.*',
                    username: 'e2e-user',
                    client_id: 'client',
                    clientFhirPersonId: personUuid,
                    clientFhirPatientId: patientUuid,
                    bwellFhirPersonId: personUuid,
                    bwellFhirPatientId: patientUuid,
                    token_use: 'access'
                })
            );
        expect(resp.status).toBe(200);

        // Flush audit events through the pipeline into ClickHouse
        const container = getTestContainer();
        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 10 });
        const auditLogger = container.auditLogger;
        await auditLogger.flushAsync();

        // Query access history
        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Parameters');
        expect(resp.body.parameter).toHaveLength(1);

        const accessor = resp.body.parameter[0];
        const referencePart = accessor.part.find((p) => p.name === 'reference');
        expect(referencePart.valueReference.reference).toBe(`Patient/person.${personUuid}`);

        const totalCountPart = accessor.part.find((p) => p.name === 'totalCount');
        expect(totalCountPart.valueInteger).toBe(1);
    });

    test('$access-history returns resource type breakdown for multiple entity types', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const patientUuid = resp.body.uuid;

        const obs = deepcopy(observation1Resource);
        obs.subject.reference = `Patient/${patientUuid}`;
        resp = await request
            .post('/4_0_0/Observation/1/$merge?validate=true')
            .send(obs)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const observationUuid = resp.body.uuid;

        const accessorRef = 'Practitioner/dr-reader-uuid';
        await insertAuditEventRows([
            {
                id: 'ae-patient-read',
                _uuid: 'ae-uuid-patient-read',
                recorded: daysAgo(1),
                action: 'R',
                agent_who: [accessorRef],
                agent_altid: [],
                entity_what: [`Patient/${patientUuid}`],
                agent_requestor_who: accessorRef
            },
            {
                id: 'ae-obs-read',
                _uuid: 'ae-uuid-obs-read',
                recorded: daysAgo(1),
                action: 'R',
                agent_who: [accessorRef],
                agent_altid: [],
                entity_what: [`Observation/${observationUuid}`],
                agent_requestor_who: accessorRef
            }
        ]);

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.parameter).toHaveLength(1);

        const accessor = resp.body.parameter[0];
        const totalCountPart = accessor.part.find((p) => p.name === 'totalCount');
        expect(totalCountPart.valueInteger).toBe(2);

        const resourceTypeParts = accessor.part.filter((p) => p.name === 'resourceType');
        expect(resourceTypeParts).toHaveLength(2);

        const patientType = resourceTypeParts.find(
            (p) => p.part.find((pp) => pp.name === 'type').valueCode === 'Patient'
        );
        expect(patientType).toBeDefined();
        expect(patientType.part.find((pp) => pp.name === 'count').valueInteger).toBe(1);

        const obsType = resourceTypeParts.find(
            (p) => p.part.find((pp) => pp.name === 'type').valueCode === 'Observation'
        );
        expect(obsType).toBeDefined();
        expect(obsType.part.find((pp) => pp.name === 'count').valueInteger).toBe(1);
    });

    test('$access-history returns 404 when Person does not exist', async () => {
        const request = sharedRequest;

        const resp = await request
            .get('/4_0_0/Person/non-existent-person/$access-history')
            .set(getHeaders());

        expect(resp.status).toBe(404);
    });

    test('$access-history returns 403 for patient scope accessing another person', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(
                getHeadersWithCustomPayload({
                    scope: 'patient/*.read user/*.read access/*.*',
                    username: 'test-user',
                    client_id: 'client',
                    clientFhirPersonId: 'different-person-id',
                    clientFhirPatientId: 'different-patient-id',
                    bwellFhirPersonId: 'different-person-id',
                    bwellFhirPatientId: 'different-patient-id',
                    token_use: 'access'
                })
            );

        expect(resp.status).toBe(403);
    });

    test('$access-history groups multiple accessors correctly', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const patientUuid = resp.body.uuid;

        const accessor1 = 'Practitioner/dr-one-uuid';
        const accessor2 = 'Patient/person.accessor-person-1';
        const entityRef = `Patient/${patientUuid}`;

        await insertAuditEventRows([
            {
                id: 'ae-accessor1',
                _uuid: 'ae-uuid-accessor1',
                recorded: daysAgo(2),
                action: 'R',
                agent_who: [accessor1],
                agent_altid: [],
                entity_what: [entityRef],
                agent_requestor_who: accessor1
            },
            {
                id: 'ae-accessor2',
                _uuid: 'ae-uuid-accessor2',
                recorded: daysAgo(1),
                action: 'R',
                agent_who: [accessor2],
                agent_altid: [],
                entity_what: [entityRef],
                agent_requestor_who: accessor2
            }
        ]);

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.parameter).toHaveLength(2);

        const practitionerAccessor = resp.body.parameter.find((p) =>
            p.part.some(
                (pp) => pp.name === 'reference' && pp.valueReference.reference === accessor1
            )
        );
        expect(practitionerAccessor).toBeDefined();

        const patientAccessor = resp.body.parameter.find((p) =>
            p.part.some(
                (pp) => pp.name === 'reference' && pp.valueReference.reference === accessor2
            )
        );
        expect(patientAccessor).toBeDefined();
    });

    test('$access-history aggregates access counts across different recorded months', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const patientUuid = resp.body.uuid;

        const accessorRef = 'Practitioner/dr-reader-uuid';
        const entityRef = `Patient/${patientUuid}`;

        const recentDate = daysAgo(1);
        const oneMonthAgo = daysAgo(35);
        const twoMonthsAgo = daysAgo(65);

        await insertAuditEventRows([
            {
                id: 'ae-oldest',
                _uuid: 'ae-uuid-oldest',
                recorded: twoMonthsAgo,
                action: 'R',
                agent_who: [accessorRef],
                agent_altid: [],
                entity_what: [entityRef],
                agent_requestor_who: accessorRef
            },
            {
                id: 'ae-middle',
                _uuid: 'ae-uuid-middle',
                recorded: oneMonthAgo,
                action: 'R',
                agent_who: [accessorRef],
                agent_altid: [],
                entity_what: [entityRef],
                agent_requestor_who: accessorRef
            },
            {
                id: 'ae-recent',
                _uuid: 'ae-uuid-recent',
                recorded: recentDate,
                action: 'R',
                agent_who: [accessorRef],
                agent_altid: [],
                entity_what: [entityRef],
                agent_requestor_who: accessorRef
            }
        ]);

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.resourceType).toBe('Parameters');
        expect(resp.body.parameter).toHaveLength(1);

        const accessor = resp.body.parameter[0];
        const referencePart = accessor.part.find((p) => p.name === 'reference');
        expect(referencePart.valueReference.reference).toBe(accessorRef);

        const totalCountPart = accessor.part.find((p) => p.name === 'totalCount');
        expect(totalCountPart.valueInteger).toBe(3);

        const lastAccessedPart = accessor.part.find((p) => p.name === 'lastAccessed');
        expect(lastAccessedPart.valueDateTime).toBeDefined();

        const resourceTypeParts = accessor.part.filter((p) => p.name === 'resourceType');
        expect(resourceTypeParts).toHaveLength(1);
        const patientType = resourceTypeParts[0];
        expect(patientType.part.find((pp) => pp.name === 'type').valueCode).toBe('Patient');
        expect(patientType.part.find((pp) => pp.name === 'count').valueInteger).toBe(3);
    });

    test('$access-history returns purposeOfEvent codes', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(patient1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const patientUuid = resp.body.uuid;

        const accessorRef = 'Patient/person.purpose-test-person';
        const entityRef = `Patient/${patientUuid}`;

        await insertAuditEventRows([{
            id: 'ae-purpose',
            _uuid: 'ae-uuid-purpose',
            recorded: daysAgo(1),
            action: 'R',
            agent_who: [accessorRef],
            agent_altid: [],
            entity_what: [entityRef],
            agent_requestor_who: accessorRef,
            purpose_of_event: [
                { system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'HPAYMT' }
            ]
        }]);

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(200);
        expect(resp.body.parameter).toHaveLength(1);

        const accessor = resp.body.parameter[0];
        const referencePart = accessor.part.find((p) => p.name === 'reference');
        expect(referencePart.valueReference.reference).toBe(accessorRef);

        const purposeParts = accessor.part.filter((p) => p.name === 'purposeOfEvent');
        expect(purposeParts).toHaveLength(1);
        expect(purposeParts[0].valueCoding.system).toBe(
            'http://terminology.hl7.org/CodeSystem/v3-ActReason'
        );
        expect(purposeParts[0].valueCoding.code).toBe('HPAYMT');
    });

    test('$access-history returns 400 when ClickHouse is not enabled', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        const container = getTestContainer();
        container.accessHistoryOperation.accessHistoryClickHouseRepository = null;

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        expect(resp.status).toBe(400);

        container.accessHistoryOperation.accessHistoryClickHouseRepository = clickHouseRepository;
    });
});
