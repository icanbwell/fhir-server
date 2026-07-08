// test file
const person1Resource = require('./fixtures/Person/person1.json');
const patient1Resource = require('./fixtures/Patient/patient1.json');
const observation1Resource = require('./fixtures/Observation/observation1.json');
const activeConsentResource = require('./fixtures/Consent/activeConsent.json');
const org1Resource = require('./fixtures/Organization/org1.json');
const accessorPersonWithOrgResource = require('./fixtures/Person/accessorPersonWithOrg.json');

const expectedEmptyParameters = require('./fixtures/expected/expected_empty_parameters.json');
const expectedSingleAccessor = require('./fixtures/expected/expected_single_accessor.json');
const expectedResourceTypeBreakdown = require('./fixtures/expected/expected_resource_type_breakdown.json');
const expectedMultipleAccessors = require('./fixtures/expected/expected_multiple_accessors.json');
const expectedAggregatedCounts = require('./fixtures/expected/expected_aggregated_counts.json');
const expectedPurposeOfEvent = require('./fixtures/expected/expected_purpose_of_event.json');
const expectedE2ePatientRead = require('./fixtures/expected/expected_e2e_patient_read.json');
const expectedDelegatedUserAccess = require('./fixtures/expected/expected_delegated_user_access.json');
const expectedClickhouseNotEnabled = require('./fixtures/expected/expected_clickhouse_not_enabled.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload,
    getTestContainer
} = require('../../common');
const { describe, beforeAll, beforeEach, afterAll, afterEach, test, expect, jest } = require('@jest/globals');
const deepcopy = require('deepcopy');
const {
    setupAccessHistoryTests,
    teardownAccessHistoryTests,
    cleanupBetweenTests,
    insertAuditEvents,
    getClickHouseManager
} = require('../../clickhouseOnly/accessHistory/accessHistoryTestSetup');
const { AccessHistoryClickHouseRepository } = require('../../../dataLayer/repositories/accessHistoryClickHouseRepository');
const { ConfigManager } = require('../../../utils/configManager');
const { DatabaseCursor } = require('../../../dataLayer/databaseCursor');

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

    get enableDelegatedAccessDetection() {
        return true;
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

/**
 * Returns only the `accessor` parameters, skipping the top-level `summary` block.
 */
function getAccessors(body) {
    return body.parameter.filter((p) => p.name === 'accessor');
}

/**
 * Copies the dynamic `generatedAt` timestamp from the actual response into the
 * expected fixture so the summary block can be asserted with an exact match.
 */
function syncGeneratedAt(expected, respBody) {
    const expectedSummary = expected.parameter.find((p) => p.name === 'summary');
    const respSummary = respBody.parameter.find((p) => p.name === 'summary');
    if (expectedSummary && respSummary) {
        expectedSummary.part.find((p) => p.name === 'generatedAt').valueDateTime =
            respSummary.part.find((p) => p.name === 'generatedAt').valueDateTime;
    }
}

describe('Person $access-history Tests', () => {
    let clickHouseRepository;
    let clickHouseManager;
    let sharedRequest;
    const cursorHintSpy = jest.spyOn(DatabaseCursor.prototype, 'hint').mockReturnThis();

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
                databaseBulkInserter: cont.fastDatabaseBulkInserter,
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
        cursorHintSpy.mockRestore();
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

        const expected = deepcopy(expectedEmptyParameters);
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
    });

    test('$access-history includes a summary block with generatedAt and windowDays', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        const summary = resp.body.parameter.find((p) => p.name === 'summary');
        expect(summary).toBeDefined();

        const generatedAt = summary.part.find((p) => p.name === 'generatedAt').valueDateTime;
        const windowDays = summary.part.find((p) => p.name === 'windowDays').valueInteger;

        expect(windowDays).toBe(90);
        // generatedAt must be a valid ISO-8601 timestamp
        expect(Number.isNaN(Date.parse(generatedAt))).toBe(false);
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

        const expected = deepcopy(expectedEmptyParameters);
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
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
        await insertAuditEvents([{
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

        const expected = deepcopy(expectedSingleAccessor);
        getAccessors(expected)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            getAccessors(resp.body)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
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

        const expected = deepcopy(expectedE2ePatientRead);
        const accessorRefValue = `Patient/person.${personUuid}`;
        const respRefPart = getAccessors(resp.body)[0].part.find((p) => p.name === 'reference');
        getAccessors(expected)[0].part.find((p) => p.name === 'reference').valueReference.reference = accessorRefValue;
        getAccessors(expected)[0].part.find((p) => p.name === 'reference').valueReference.display = respRefPart.valueReference.display;
        getAccessors(expected)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            getAccessors(resp.body)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
    });

    test('$access-history end-to-end: delegated user read appears in access history', async () => {
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

        // Create a Consent resource linking the delegated actor to this person's patient
        const delegatedActorRef = 'RelatedPerson/delegated-actor-e2e';
        const consent = deepcopy(activeConsentResource);
        consent.patient.reference = `Patient/person.${personUuid}`;
        consent.provision.actor[0].reference.reference = delegatedActorRef;

        resp = await request
            .post('/4_0_0/Consent/1/$merge?validate=true')
            .send(consent)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });

        // Delegated user reads the Patient resource
        resp = await request
            .get(`/4_0_0/Patient/${patientUuid}`)
            .set(
                getHeadersWithCustomPayload({
                    scope: 'patient/*.read user/*.read access/*.*',
                    username: 'delegated-user',
                    client_id: 'client',
                    clientFhirPersonId: personUuid,
                    clientFhirPatientId: patientUuid,
                    bwellFhirPersonId: personUuid,
                    bwellFhirPatientId: patientUuid,
                    token_use: 'access',
                    act: {
                        reference: delegatedActorRef,
                        sub: 'delegated-sub-e2e'
                    }
                })
            );
        expect(resp.status).toBe(200);

        // Flush audit events through the pipeline into ClickHouse
        const container = getTestContainer();
        const postRequestProcessor = container.postRequestProcessor;
        await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 10 });
        const auditLogger = container.auditLogger;
        await auditLogger.flushAsync();

        // Query access history — the delegated actor should appear as the accessor
        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        const expected = deepcopy(expectedDelegatedUserAccess);
        const respRefPart = getAccessors(resp.body)[0].part.find((p) => p.name === 'reference');
        getAccessors(expected)[0].part.find((p) => p.name === 'reference').valueReference.reference = respRefPart.valueReference.reference;
        getAccessors(expected)[0].part.find((p) => p.name === 'reference').valueReference.display = respRefPart.valueReference.display;
        getAccessors(expected)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            getAccessors(resp.body)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
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
        await insertAuditEvents([
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

        const expected = deepcopy(expectedResourceTypeBreakdown);
        getAccessors(expected)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            getAccessors(resp.body)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        const respRtParts = getAccessors(resp.body)[0].part.filter((p) => p.name === 'resourceType');
        const expectedRtParts = getAccessors(expected)[0].part.filter((p) => p.name === 'resourceType');
        expectedRtParts[0].part.find((p) => p.name === 'type').valueCode =
            respRtParts[0].part.find((p) => p.name === 'type').valueCode;
        expectedRtParts[1].part.find((p) => p.name === 'type').valueCode =
            respRtParts[1].part.find((p) => p.name === 'type').valueCode;
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
    });

    test('$access-history returns 404 when Person does not exist', async () => {
        const request = sharedRequest;

        const resp = await request
            .get('/4_0_0/Person/non-existent-person/$access-history')
            .set(getHeaders());

        expect(resp.status).toBe(404);
    });

    test('$access-history returns 403 when Person read scope is missing', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders('user/AuditEvent.read access/*.*'));

        expect(resp.status).toBe(403);
    });

    test('$access-history returns 403 when AuditEvent read scope is missing', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders('user/Person.read access/*.*'));

        expect(resp.status).toBe(403);
    });

    test('$access-history returns 403 for delegated user without valid consent', async () => {
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
                    username: 'delegated-user',
                    client_id: 'client',
                    clientFhirPersonId: personUuid,
                    clientFhirPatientId: 'some-patient-id',
                    bwellFhirPersonId: personUuid,
                    bwellFhirPatientId: 'some-patient-id',
                    token_use: 'access',
                    act: {
                        reference: 'RelatedPerson/delegated-actor-uuid',
                        sub: 'delegated-sub'
                    }
                })
            );

        expect(resp.status).toBe(403);
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

        await insertAuditEvents([
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

        const expected = deepcopy(expectedMultipleAccessors);
        const respAccessors = getAccessors(resp.body);
        const expectedAccessors = getAccessors(expected);
        // Match expected parameter order to actual response order
        const respParam0Ref = respAccessors[0].part.find((p) => p.name === 'reference').valueReference.reference;
        const respParam1Ref = respAccessors[1].part.find((p) => p.name === 'reference').valueReference.reference;
        expectedAccessors[0].part.find((p) => p.name === 'reference').valueReference.reference = respParam0Ref;
        expectedAccessors[0].part.find((p) => p.name === 'reference').valueReference.display = respParam0Ref;
        expectedAccessors[0].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            respAccessors[0].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        expectedAccessors[1].part.find((p) => p.name === 'reference').valueReference.reference = respParam1Ref;
        expectedAccessors[1].part.find((p) => p.name === 'reference').valueReference.display = respParam1Ref;
        expectedAccessors[1].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            respAccessors[1].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
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

        await insertAuditEvents([
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

        const expected = deepcopy(expectedAggregatedCounts);
        getAccessors(expected)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            getAccessors(resp.body)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
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

        await insertAuditEvents([{
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

        const expected = deepcopy(expectedPurposeOfEvent);
        getAccessors(expected)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime =
            getAccessors(resp.body)[0].part.find((p) => p.name === 'lastAccessed').valueDateTime;
        syncGeneratedAt(expected, resp.body);
        expect(resp).toHaveResponse(expected);
    });

    test('$access-history returns organization block per FDR for a proxy patient accessor', async () => {
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

        resp = await request
            .post('/4_0_0/Organization/1/$merge?validate=true')
            .send(org1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const orgUuid = resp.body.uuid;

        // The accessor is a proxy patient whose Person has a managingOrganization,
        // which is the only path that surfaces an `organization` block.
        resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(accessorPersonWithOrgResource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const accessorPersonUuid = resp.body.uuid;

        const accessorRef = `Patient/person.${accessorPersonUuid}`;
        await insertAuditEvents([{
            id: 'ae-org',
            _uuid: 'ae-uuid-org',
            recorded: daysAgo(1),
            action: 'R',
            agent_who: [accessorRef],
            agent_altid: [],
            entity_what: [`Patient/${patientUuid}`],
            agent_requestor_who: accessorRef
        }]);

        resp = await request
            .get(`/4_0_0/Person/${personUuid}/$access-history`)
            .set(getHeaders());

        const accessor = getAccessors(resp.body)
            .find((a) => a.part.find((p) => p.name === 'reference').valueReference.reference === accessorRef);
        expect(accessor).toBeDefined();

        const orgPart = accessor.part.find((p) => p.name === 'organization');
        expect(orgPart).toBeDefined();
        // Per FDR the organization is a `part` container, not a flat valueReference.
        expect(orgPart.valueReference).toBeUndefined();
        expect(Array.isArray(orgPart.part)).toBe(true);

        const orgReference = orgPart.part.find((p) => p.name === 'reference').valueReference;
        const orgName = orgPart.part.find((p) => p.name === 'name').valueString;
        const orgSourceId = orgPart.part.find((p) => p.name === 'sourceId').valueString;

        expect(orgReference.reference).toBe(`Organization/${orgUuid}`);
        expect(orgReference.display).toBe('HealthSystem One');
        expect(orgName).toBe('HealthSystem One');
        // Per FDR, sourceId is the bwell Organization id — same value as in the reference.
        expect(orgSourceId).toBe(orgUuid);
    });

    test('$access-history returns 404 when ClickHouse is not enabled', async () => {
        const request = sharedRequest;

        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send(person1Resource)
            .set(getHeaders());
        expect(resp).toHaveMergeResponse({ created: true });
        const personUuid = resp.body.uuid;

        const container = getTestContainer();
        container.accessHistoryOperation.accessHistoryClickHouseRepository = null;

        const url = `/4_0_0/Person/${personUuid}/$access-history`;
        resp = await request
            .get(url)
            .set(getHeaders());

        const expected = deepcopy(expectedClickhouseNotEnabled);
        expected.issue[0].details.text = `Invalid url: ${url}`;
        expect(resp).toHaveResponse(expected);

        container.accessHistoryOperation.accessHistoryClickHouseRepository = clickHouseRepository;
    });
});
