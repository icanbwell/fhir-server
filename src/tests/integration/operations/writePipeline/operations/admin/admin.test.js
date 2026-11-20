const originalWritePipelineOperations = process.env.WRITE_PIPELINE_OPERATIONS;
process.env.WRITE_PIPELINE_OPERATIONS = 'merge,create,update,patch,admin';

const deepcopy = require('deepcopy');

const personA = require('./fixtures/personA.json');
const personA2 = require('./fixtures/personA2.json');
const personB = require('./fixtures/personB.json');
const personB2 = require('./fixtures/personB2.json');
const patientA = require('./fixtures/patientA.json');
const patientA2 = require('./fixtures/patientA2.json');
const patientB = require('./fixtures/patientB.json');
const encounterA = require('./fixtures/encounterA.json');
const encounterB = require('./fixtures/encounterB.json');
const organizationA = require('./fixtures/organizationA.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersJsonPatch,
    getHeadersWithScopeAndGroups,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { AuditLogger } = require('../../../../../../utils/auditLogger');
const { generateUUIDv5, isUuid } = require('../../../../../../utils/uid.util');
const { describe, beforeEach, afterEach, afterAll, test, expect, jest } = require('@jest/globals');

/**
 * The resource types the cases store and change; the "nothing written" check reads all of them.
 */
const RESOURCE_TYPES = ['Person', 'Patient', 'Encounter', 'Organization'];

/**
 * The system of the owner security tag, whose code is the resource's source assigning authority.
 */
const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';

/**
 * Returns the `_uuid` the server gives the fixture: its `id` and its owner tag's code.
 */
const uuidOf = (resource) =>
    generateUUIDv5(
        `${resource.id}|${resource.meta.security.find((tag) => tag.system === OWNER_SYSTEM).code}`
    );

const PERSON_A = uuidOf(personA);
const PERSON_A2 = uuidOf(personA2);
const PERSON_B = uuidOf(personB);
const PERSON_B2 = uuidOf(personB2);
const PATIENT_A = uuidOf(patientA);
const PATIENT_A2 = uuidOf(patientA2);
const PATIENT_B = uuidOf(patientB);
const ENCOUNTER_A = uuidOf(encounterA);
const ENCOUNTER_B = uuidOf(encounterB);
const ORGANIZATION_A = uuidOf(organizationA);

/**
 * A `_uuid` that no stored resource has.
 */
const MISSING_UUID = generateUUIDv5('admin-missing-resource|tenant-a');

/**
 * Returns admin request headers for a token with exactly the given scopes.
 */
const adminHeaders = (scope) => getHeadersWithScopeAndGroups({ scope });

/**
 * A caller with write access to `tenant-a` only.
 */
const TENANT_A_SCOPE = 'user/*.* access/tenant-a.* admin/*.*';

/**
 * A caller with write access to every tenant.
 */
const ALL_TENANTS_SCOPE = 'user/*.* access/*.* admin/*.*';

/**
 * A caller with write access to `tenant-a` and read access to `tenant-b`.
 */
const TENANT_A_WRITE_TENANT_B_READ_SCOPE =
    'user/*.* access/tenant-a.* access/tenant-b.read admin/*.*';

/**
 * A caller with write access to `tenant-a` and `tenant-b`.
 */
const TENANT_A_AND_B_WRITE_SCOPE = 'user/*.* access/tenant-a.* access/tenant-b.* admin/*.*';

/**
 * A caller that may read, update and search `tenant-a` but not create in it (SMART v2 letters).
 */
const TENANT_A_WITHOUT_CREATE_SCOPE = 'user/*.* access/tenant-a.rus admin/*.*';

/**
 * A caller with read access to `tenant-a` and write access to `tenant-b`.
 */
const TENANT_A_READ_TENANT_B_WRITE_SCOPE =
    'user/*.* access/tenant-a.read access/tenant-b.* admin/*.*';

/**
 * A caller with an admin scope that does not allow admin writes.
 */
const ADMIN_READ_ONLY_SCOPE = 'user/*.* access/*.* admin/*.read';

/**
 * A caller with no admin scope at all.
 */
const NO_ADMIN_SCOPE = 'user/*.* access/*.*';

/**
 * Returns a copy of the Person with one link per reference.
 */
const withLinks = (person, references) => ({
    ...deepcopy(person),
    link: references.map((reference) => ({ target: { reference } }))
});

/**
 * Returns a copy of the Encounter with the given subject, or without one when it is undefined.
 */
const withSubject = (encounter, subject) => {
    const copy = deepcopy(encounter);
    delete copy.subject;
    return subject ? { ...copy, subject } : copy;
};

/**
 * Returns the `_uuid` of every link target of a stored Person, in link order.
 */
const linkUuids = (person) => (person.link || []).map((link) => link.target._uuid);

/**
 * Returns the `reference`, `_uuid` and `_sourceId` of every link target of a stored Person, in
 * link order.
 */
const linkFields = (person) =>
    (person.link || []).map(({ target }) => [target.reference, target._uuid, target._sourceId]);

/**
 * Returns the reference and the global id fields of a stored Encounter's subject.
 */
const subjectFields = (encounter) => ({
    reference: encounter.subject.reference,
    _uuid: encounter.subject._uuid,
    _sourceId: encounter.subject._sourceId,
    _sourceAssigningAuthority: encounter.subject._sourceAssigningAuthority
});

/**
 * Replaces the test container's mock audit logger with the real `AuditLogger`, so AuditEvents are
 * written to the audit database.
 */
const registerRealAuditLogger = (container) => {
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
};

/**
 * Returns the collection of the resource type in the database the server writes it to.
 */
const collectionOf = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    return db.collection(`${resourceType}_4_0_0`);
};

/**
 * Returns the history collection of the resource type.
 */
const historyCollectionOf = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
    return db.collection(`${resourceType}_4_0_0_History`);
};

/**
 * Reads the stored document of the resource with the `_uuid`, or null.
 */
const readStoredAsync = async (resourceType, uuid) =>
    (await collectionOf(resourceType)).findOne({ _uuid: uuid }, { projection: { _id: 0 } });

/**
 * Reads every history row of the resource with the `_uuid`, oldest version first.
 */
const readHistoryAsync = async (resourceType, uuid) =>
    (await historyCollectionOf(resourceType))
        .find({ 'resource._uuid': uuid })
        .sort({ 'resource.meta.versionId': 1 })
        .toArray();

/**
 * Reads every stored document and the number of history rows of each resource type the cases
 * use, so a case can check that nothing was written.
 */
const snapshotAsync = async () => {
    const snapshot = {};
    for (const resourceType of RESOURCE_TYPES) {
        snapshot[`${resourceType}`] = {
            documents: await (
                await collectionOf(resourceType)
            )
                .find({}, { projection: { _id: 0 } })
                .sort({ _uuid: 1 })
                .toArray(),
            historyRows: await (await historyCollectionOf(resourceType)).countDocuments({})
        };
    }
    return snapshot;
};

/**
 * Writes the queued AuditEvents and returns every AuditEvent in the audit database.
 */
const readAuditEventsAsync = async () => {
    const { auditLogger, mongoDatabaseManager } = getTestContainer();
    await auditLogger.flushAsync();
    const db = await mongoDatabaseManager.getAuditDbAsync();
    return db.collection('AuditEvent_4_0_0').find({}).toArray();
};

/**
 * Reads the error AuditEvents (action `E`) until there is at least one, or the attempts run out,
 * because the route queues an error audit event without waiting for it.
 */
const readErrorAuditEventsAsync = async () => {
    let errorAuditEvents = [];
    for (let attempt = 0; attempt < 20 && errorAuditEvents.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        errorAuditEvents = (await readAuditEventsAsync()).filter(
            (auditEvent) => auditEvent.action === 'E'
        );
    }
    return errorAuditEvents;
};

/**
 * Returns the action and the entity references of each AuditEvent.
 */
const summarizeAuditEvents = (auditEvents) =>
    auditEvents.map((auditEvent) => ({
        action: auditEvent.action,
        references: auditEvent.entity.map((entity) => entity.what.reference)
    }));

/**
 * Stores the resources through `$merge` with full access, waits for the post-request tasks and
 * removes the AuditEvents the setup wrote, so a case sees only its own.
 */
const storeAsync = async (request, resources) => {
    for (const resource of resources) {
        const response = await request
            .post(`/4_0_0/${resource.resourceType}/$merge`)
            .send(resource)
            .set(getHeaders());
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ created: true });
    }
    const { postRequestProcessor, mongoDatabaseManager } = getTestContainer();
    await postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });
    await readAuditEventsAsync();
    const db = await mongoDatabaseManager.getAuditDbAsync();
    await db.collection('AuditEvent_4_0_0').deleteMany({});
};

/**
 * Sends the admin write operation with the body and the token scope.
 */
const adminPost = (request, operation, body, scope = TENANT_A_SCOPE) =>
    request.post(`/admin/${operation}`).send(body).set(adminHeaders(scope));

/**
 * Builds the test request and returns it with a spy on the manual-link Kafka event producer of
 * the test container, which is built once per file.
 */
const createRequestWithEventSpyAsync = async () => {
    const request = await createTestRequest(registerRealAuditLogger);
    const produceEventAsync = jest.spyOn(
        getTestContainer().patientPersonManualLinkingEventProducer,
        'produceEventAsync'
    );
    return { request, produceEventAsync };
};

/**
 * Checks that the response is an OperationOutcome with the status and the issue code.
 */
const expectOperationOutcome = (response, status, code) => {
    expect(response.status).toBe(status);
    expect(response.body.resourceType).toBe('OperationOutcome');
    expect(response.body.issue).toHaveLength(1);
    expect(response.body.issue[0]).toMatchObject({ severity: 'error', code });
};

/**
 * Checks that the stored documents and the history rows are as in the snapshot, that no AuditEvent
 * records a create or an update, and that no manual-link event was sent.
 */
const expectNothingWrittenAsync = async ({ before, produceEventAsync }) => {
    expect(await snapshotAsync()).toEqual(before);
    const writeAudits = (await readAuditEventsAsync()).filter((auditEvent) =>
        ['C', 'U'].includes(auditEvent.action)
    );
    expect(writeAudits).toEqual([]);
    expect(produceEventAsync).not.toHaveBeenCalled();
};

/**
 * One successful write per operation: what is stored first, the request body, today's success
 * body, the changed resource, how its state is read and what it must be after the write, and the
 * manual-link event the write sends.
 */
const successCases = [
    {
        operation: 'createPersonToPersonLink',
        stored: [personA, personA2],
        body: { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 },
        response: {
            message: `Added link from Person/${PERSON_A} to Person/${PERSON_A2}`,
            bwellPersonId: PERSON_A,
            externalPersonId: PERSON_A2
        },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [`Person/${PERSON_A2}`],
        linkEvent: null
    },
    {
        operation: 'removePersonToPersonLink',
        stored: [withLinks(personA, [`Person/${PERSON_A2}`]), personA2],
        body: { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 },
        response: {
            message: `Removed link from Person/${PERSON_A} to Person/${PERSON_A2}`,
            bwellPersonId: PERSON_A,
            externalPersonId: PERSON_A2
        },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [],
        linkEvent: null
    },
    {
        operation: 'createPersonToPatientLink',
        stored: [personA, patientA],
        body: { externalPersonId: PERSON_A, patientId: PATIENT_A },
        response: {
            message: `Added link from Person/${PERSON_A} to Patient/${PATIENT_A}`,
            patientId: PATIENT_A,
            externalPersonId: PERSON_A
        },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [`Patient/${PATIENT_A}`],
        linkEvent: { personId: PERSON_A, patientId: PATIENT_A, isLinking: true }
    },
    {
        operation: 'removePersonToPatientLink',
        stored: [withLinks(personA, [`Patient/${PATIENT_A}`]), patientA],
        body: { personId: PERSON_A, patientId: PATIENT_A },
        response: {
            message: `Removed link from Person/${PERSON_A} to Patient/${PATIENT_A}`,
            personId: PERSON_A,
            patientId: PATIENT_A
        },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [],
        linkEvent: { personId: PERSON_A, patientId: PATIENT_A, isLinking: false }
    },
    {
        operation: 'updatePatientReference',
        stored: [encounterA, patientA2],
        body: { resourceType: 'Encounter', resourceId: ENCOUNTER_A, patientId: PATIENT_A2 },
        response: {
            message: `Patient reference updated for Encounter with id ${ENCOUNTER_A}`,
            patientId: PATIENT_A2
        },
        target: { resourceType: 'Encounter', uuid: ENCOUNTER_A },
        stateOf: (encounter) => encounter.subject._uuid,
        expectedState: `Patient/${PATIENT_A2}`,
        linkEvent: null
    }
];

/**
 * The success case of each operation, by operation name.
 */
const successCaseOf = Object.fromEntries(
    successCases.map((successCase) => [successCase.operation, successCase])
);

/**
 * One no-op per operation that has one, and the `updatePatientReference` requests that find no
 * patient reference to rewrite: what is stored, the request body and today's no-op body.
 */
const noOpCases = [
    {
        name: 'createPersonToPersonLink with the link in place',
        operation: 'createPersonToPersonLink',
        stored: [withLinks(personA, [`Person/${PERSON_A2}`]), personA2],
        body: { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 },
        response: {
            message: `Link already exists from ${PERSON_A} to ${PERSON_A2}`,
            bwellPersonId: PERSON_A,
            externalPersonId: PERSON_A2
        }
    },
    {
        name: 'removePersonToPersonLink with no such link',
        operation: 'removePersonToPersonLink',
        stored: [personA, personA2],
        body: { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 },
        response: {
            message: `No Link exists from Person/${PERSON_A} to Person/${PERSON_A2}`,
            bwellPersonId: PERSON_A,
            externalPersonId: PERSON_A2
        }
    },
    {
        name: 'createPersonToPatientLink with the link in place',
        operation: 'createPersonToPatientLink',
        stored: [withLinks(personA, [`Patient/${PATIENT_A}`]), patientA],
        body: { externalPersonId: PERSON_A, patientId: PATIENT_A },
        response: {
            message: `Link already exists from Person/${PERSON_A} to Patient/${PATIENT_A}`,
            patientId: PATIENT_A,
            externalPersonId: PERSON_A
        }
    },
    {
        name: 'removePersonToPatientLink with no such link',
        operation: 'removePersonToPatientLink',
        stored: [personA, patientA],
        body: { personId: PERSON_A, patientId: PATIENT_A },
        response: {
            message: `No Link exists from Person/${PERSON_A} to Patient/${PATIENT_A}`,
            personId: PERSON_A,
            patientId: PATIENT_A
        }
    },
    {
        name: 'updatePatientReference to the Patient already referenced',
        operation: 'updatePatientReference',
        stored: [withSubject(encounterA, { reference: `Patient/${PATIENT_A2}` }), patientA2],
        body: { resourceType: 'Encounter', resourceId: ENCOUNTER_A, patientId: PATIENT_A2 },
        response: {
            message: `Couldn't update Patient reference in Encounter with id ${ENCOUNTER_A}`,
            patientId: PATIENT_A2
        }
    },
    {
        name: 'updatePatientReference on a Person',
        operation: 'updatePatientReference',
        stored: [personA, patientA2],
        body: { resourceType: 'Person', resourceId: PERSON_A, patientId: PATIENT_A2 },
        response: {
            message: `Couldn't update Patient reference in Person with id ${PERSON_A}`,
            patientId: PATIENT_A2
        }
    },
    {
        name: 'updatePatientReference on a type with no patient field',
        operation: 'updatePatientReference',
        stored: [organizationA, patientA2],
        body: { resourceType: 'Organization', resourceId: ORGANIZATION_A, patientId: PATIENT_A2 },
        response: {
            message: `Couldn't update Patient reference in Organization with id ${ORGANIZATION_A}`,
            patientId: PATIENT_A2
        }
    },
    {
        name: 'updatePatientReference on an Encounter with no subject',
        operation: 'updatePatientReference',
        stored: [withSubject(encounterA, undefined), patientA2],
        body: { resourceType: 'Encounter', resourceId: ENCOUNTER_A, patientId: PATIENT_A2 },
        response: {
            message: `Couldn't update Patient reference in Encounter with id ${ENCOUNTER_A}`,
            patientId: PATIENT_A2
        }
    }
];

/**
 * Returns a copy of the resource with the meta of the other fixture, so the same `id` is stored in
 * the other fixture's tenant, with its own `_uuid`.
 */
const inTenantOf = (resource, tenantFixture) => ({
    ...deepcopy(resource),
    meta: deepcopy(tenantFixture.meta)
});

/**
 * The `_uuid` the server gives a copy of the fixture stored in `tenant-b`.
 */
const tenantBUuidOf = (resource) => generateUUIDv5(`${resource.id}|tenant-b`);

/**
 * Per operation, the bodies that name its resources by their plain `id` instead of their `_uuid`,
 * bare and with a `Person/` or `Patient/` prefix (any resource type on `resourceId`), and what the
 * write must answer and store: today's body with the ids as sent, without their prefix; an added
 * link names the id as sent, with the `_uuid` and `_sourceId` preSave gives it, and a rewritten
 * patient reference names the new Patient's `_uuid`. The adds run for a caller with access to
 * every tenant, for whom the Person.link check keeps the reference as sent.
 */
const plainIdCases = [
    {
        operation: 'createPersonToPersonLink',
        stored: [personA, personA2],
        bodies: [
            { bwellPersonId: personA.id, externalPersonId: personA2.id },
            { bwellPersonId: `Person/${personA.id}`, externalPersonId: `Person/${personA2.id}` }
        ],
        response: {
            message: `Added link from Person/${personA.id} to Person/${personA2.id}`,
            bwellPersonId: personA.id,
            externalPersonId: personA2.id
        },
        scope: ALL_TENANTS_SCOPE,
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkFields,
        expectedState: [[`Person/${personA2.id}`, `Person/${PERSON_A2}`, `Person/${personA2.id}`]],
        linkEvent: null
    },
    {
        operation: 'removePersonToPersonLink',
        stored: [withLinks(personA, [`Person/${personA2.id}`]), personA2],
        bodies: [
            { bwellPersonId: personA.id, externalPersonId: personA2.id },
            { bwellPersonId: `Person/${personA.id}`, externalPersonId: `Person/${personA2.id}` }
        ],
        response: {
            message: `Removed link from Person/${personA.id} to Person/${personA2.id}`,
            bwellPersonId: personA.id,
            externalPersonId: personA2.id
        },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [],
        linkEvent: null
    },
    {
        operation: 'createPersonToPatientLink',
        stored: [personA, patientA],
        bodies: [
            { externalPersonId: personA.id, patientId: patientA.id },
            { externalPersonId: `Person/${personA.id}`, patientId: `Patient/${patientA.id}` }
        ],
        response: {
            message: `Added link from Person/${personA.id} to Patient/${patientA.id}`,
            patientId: patientA.id,
            externalPersonId: personA.id
        },
        scope: ALL_TENANTS_SCOPE,
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkFields,
        expectedState: [[`Patient/${patientA.id}`, `Patient/${PATIENT_A}`, `Patient/${patientA.id}`]],
        linkEvent: { personId: PERSON_A, patientId: patientA.id, isLinking: true }
    },
    {
        operation: 'removePersonToPatientLink',
        stored: [withLinks(personA, [`Patient/${patientA.id}`]), patientA],
        bodies: [
            { personId: personA.id, patientId: patientA.id },
            { personId: `Person/${personA.id}`, patientId: `Patient/${patientA.id}` }
        ],
        response: {
            message: `Removed link from Person/${personA.id} to Patient/${patientA.id}`,
            personId: personA.id,
            patientId: patientA.id
        },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [],
        linkEvent: { personId: PERSON_A, patientId: patientA.id, isLinking: false }
    },
    {
        operation: 'updatePatientReference',
        stored: [encounterA, patientA2],
        bodies: [
            { resourceType: 'Encounter', resourceId: encounterA.id, patientId: patientA2.id },
            {
                resourceType: 'Encounter',
                resourceId: `Encounter/${encounterA.id}`,
                patientId: `Patient/${patientA2.id}`
            }
        ],
        response: {
            message: `Patient reference updated for Encounter with id ${encounterA.id}`,
            patientId: patientA2.id
        },
        target: { resourceType: 'Encounter', uuid: ENCOUNTER_A },
        stateOf: (encounter) => [encounter.subject.reference, encounter.subject._uuid],
        expectedState: [`Patient/${PATIENT_A2}`, `Patient/${PATIENT_A2}`],
        linkEvent: null
    }
].flatMap(({ bodies, ...plainIdCase }) =>
    bodies.map((body, index) => ({ ...plainIdCase, body, form: index === 0 ? 'bare' : 'prefixed' }))
);

/**
 * The bodies that name a linked resource, or the target of `updatePatientReference`, as
 * `id|authority`, and the stored `_uuid` the write must use.
 */
const idWithAuthorityCases = [
    {
        operation: 'createPersonToPersonLink',
        stored: [personA, personA2],
        body: { bwellPersonId: PERSON_A, externalPersonId: `${personA2.id}|tenant-a` },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [`Person/${PERSON_A2}`]
    },
    {
        operation: 'createPersonToPatientLink',
        stored: [personA, patientA],
        body: { externalPersonId: PERSON_A, patientId: `${patientA.id}|tenant-a` },
        target: { resourceType: 'Person', uuid: PERSON_A },
        stateOf: linkUuids,
        expectedState: [`Patient/${PATIENT_A}`]
    },
    {
        operation: 'updatePatientReference',
        stored: [encounterA, patientA2],
        body: {
            resourceType: 'Encounter',
            resourceId: `${encounterA.id}|tenant-a`,
            patientId: `${patientA2.id}|tenant-a`
        },
        target: { resourceType: 'Encounter', uuid: ENCOUNTER_A },
        stateOf: (encounter) => encounter.subject._uuid,
        expectedState: `Patient/${PATIENT_A2}`
    }
];

/**
 * The bodies whose plain id names resources stored with that `id` in `tenant-a` and in `tenant-b`.
 * A caller with access to both tenants gets a 400 that asks for the `_uuid`; a `tenant-a` caller
 * sees only one of them and gets the write on its own tenant's resource.
 */
const ambiguousIdCases = [
    {
        name: 'removePersonToPatientLink from a Person id stored in two tenants',
        operation: 'removePersonToPatientLink',
        stored: [
            withLinks(personA, [`Patient/${PATIENT_A}`]),
            withLinks(inTenantOf(personA, personB), [`Patient/${PATIENT_A}`]),
            patientA
        ],
        body: { personId: personA.id, patientId: PATIENT_A },
        message: 'The id matches more than one Person; pass the _uuid',
        tenantAWrite: { resourceType: 'Person', uuid: PERSON_A, untouched: tenantBUuidOf(personA) }
    },
    {
        name: 'updatePatientReference of an Encounter id stored in two tenants',
        operation: 'updatePatientReference',
        stored: [encounterA, inTenantOf(encounterA, personB), patientA2],
        body: { resourceType: 'Encounter', resourceId: encounterA.id, patientId: PATIENT_A2 },
        message: 'The id matches more than one Encounter; pass the _uuid',
        tenantAWrite: {
            resourceType: 'Encounter',
            uuid: ENCOUNTER_A,
            untouched: tenantBUuidOf(encounterA)
        }
    }
];

/**
 * Ids the search would read as more than one literal value, or that are too long or hold a control
 * character, each on an id parameter of an operation whose resources are stored.
 */
const unsafeIdCases = [
    {
        name: 'two _uuids joined by a comma',
        operation: 'createPersonToPersonLink',
        body: { bwellPersonId: `${PERSON_A},${PERSON_A2}`, externalPersonId: PERSON_A2 }
    },
    {
        name: 'two plain ids joined by a comma',
        operation: 'removePersonToPatientLink',
        body: { personId: `${personA.id},${personA2.id}`, patientId: PATIENT_A }
    },
    {
        name: 'an escaped comma',
        operation: 'updatePatientReference',
        body: { resourceType: 'Encounter', resourceId: `${encounterA.id}\\,x`, patientId: PATIENT_A2 }
    },
    {
        name: 'a comma in the linked Patient id',
        operation: 'createPersonToPatientLink',
        body: { externalPersonId: PERSON_A, patientId: `${patientA.id},${patientA2.id}` }
    },
    {
        name: 'an id of 256 characters',
        operation: 'createPersonToPersonLink',
        body: { bwellPersonId: 'p'.repeat(256), externalPersonId: PERSON_A2 }
    },
    {
        name: 'a control character',
        operation: 'removePersonToPersonLink',
        body: { bwellPersonId: `${personA.id}\u0007`, externalPersonId: PERSON_A2 }
    }
].map((unsafeIdCase) => ({
    ...unsafeIdCase,
    stored: [withLinks(personA, [`Patient/${PATIENT_A}`]), personA2, patientA, patientA2, encounterA]
}));

/**
 * The plain-id bodies whose target or linked resource is stored only in `tenant-b`, for a
 * `tenant-a` caller.
 */
const otherTenantPlainIdCases = [
    {
        name: 'createPersonToPersonLink from a Person id stored only in tenant-b',
        operation: 'createPersonToPersonLink',
        stored: [personB, personA2],
        body: { bwellPersonId: personB.id, externalPersonId: personA2.id },
        missing: `Person/${personB.id}`
    },
    {
        name: 'removePersonToPatientLink from a Person id stored only in tenant-b',
        operation: 'removePersonToPatientLink',
        stored: [withLinks(personB, [`Patient/${patientA.id}`]), patientA],
        body: { personId: personB.id, patientId: patientA.id },
        missing: `Person/${personB.id}`
    },
    {
        name: 'updatePatientReference of an Encounter id stored only in tenant-b',
        operation: 'updatePatientReference',
        stored: [encounterB, patientA2],
        body: { resourceType: 'Encounter', resourceId: encounterB.id, patientId: patientA2.id },
        missing: `Encounter/${encounterB.id}`
    },
    {
        name: 'updatePatientReference to a Patient id|authority stored only in tenant-b',
        operation: 'updatePatientReference',
        stored: [encounterA, patientB],
        body: {
            resourceType: 'Encounter',
            resourceId: encounterA.id,
            patientId: `${patientB.id}|tenant-b`
        },
        missing: `Patient/${patientB.id}|tenant-b`
    }
];

/**
 * Per operation, the success body with a `Person/` or `Patient/` prefix on each id it can carry.
 */
const prefixedIdCases = [
    {
        operation: 'createPersonToPersonLink',
        body: { bwellPersonId: `Person/${PERSON_A}`, externalPersonId: `Person/${PERSON_A2}` }
    },
    {
        operation: 'removePersonToPersonLink',
        body: { bwellPersonId: `Person/${PERSON_A}`, externalPersonId: `Person/${PERSON_A2}` }
    },
    {
        operation: 'createPersonToPatientLink',
        body: { externalPersonId: `Person/${PERSON_A}`, patientId: `Patient/${PATIENT_A}` }
    },
    {
        operation: 'removePersonToPatientLink',
        body: { personId: `Person/${PERSON_A}`, patientId: `Patient/${PATIENT_A}` }
    },
    {
        operation: 'updatePatientReference',
        body: {
            resourceType: 'Encounter',
            resourceId: ENCOUNTER_A,
            patientId: `Patient/${PATIENT_A2}`
        }
    }
].map((prefixedCase) => ({
    ...prefixedCase,
    ...successCaseOf[prefixedCase.operation],
    body: prefixedCase.body
}));

/**
 * Per operation, a body that leaves out one required parameter.
 */
const missingParameterCases = [
    { operation: 'createPersonToPersonLink', body: { bwellPersonId: PERSON_A } },
    { operation: 'removePersonToPersonLink', body: { externalPersonId: PERSON_A2 } },
    { operation: 'createPersonToPatientLink', body: { patientId: PATIENT_A } },
    { operation: 'removePersonToPatientLink', body: { personId: PERSON_A } },
    {
        operation: 'updatePatientReference',
        body: { resourceType: 'Encounter', patientId: PATIENT_A2 }
    }
];

/**
 * Per operation whose target must exist, a body whose target is not stored.
 */
const missingTargetCases = [
    {
        operation: 'createPersonToPersonLink',
        stored: [personA2],
        body: { bwellPersonId: MISSING_UUID, externalPersonId: PERSON_A2 },
        missing: `Person/${MISSING_UUID}`
    },
    {
        operation: 'removePersonToPersonLink',
        stored: [personA2],
        body: { bwellPersonId: MISSING_UUID, externalPersonId: PERSON_A2 },
        missing: `Person/${MISSING_UUID}`
    },
    {
        operation: 'removePersonToPatientLink',
        stored: [patientA],
        body: { personId: MISSING_UUID, patientId: PATIENT_A },
        missing: `Person/${MISSING_UUID}`
    },
    {
        operation: 'updatePatientReference',
        stored: [patientA2],
        body: { resourceType: 'Encounter', resourceId: MISSING_UUID, patientId: PATIENT_A2 },
        missing: `Encounter/${MISSING_UUID}`
    }
];

/**
 * The bodies whose looked-up linked resource (the Patient of a created Person, the new Patient) is
 * not stored.
 */
const missingLinkedCases = [
    {
        name: 'createPersonToPatientLink to a Patient that is not stored, with no Person',
        operation: 'createPersonToPatientLink',
        stored: [],
        body: { externalPersonId: PERSON_A, patientId: MISSING_UUID },
        missing: `Patient/${MISSING_UUID}`
    },
    {
        name: 'updatePatientReference to a Patient that is not stored',
        operation: 'updatePatientReference',
        stored: [encounterA],
        body: { resourceType: 'Encounter', resourceId: ENCOUNTER_A, patientId: MISSING_UUID },
        missing: `Patient/${MISSING_UUID}`
    }
];

/**
 * Per operation whose target must exist, a target stored only in `tenant-b`, for a `tenant-a`
 * caller.
 */
const otherTenantTargetCases = [
    {
        operation: 'createPersonToPersonLink',
        stored: [personB, personA2],
        body: { bwellPersonId: PERSON_B, externalPersonId: PERSON_A2 },
        missing: `Person/${PERSON_B}`
    },
    {
        operation: 'removePersonToPersonLink',
        stored: [withLinks(personB, [`Person/${PERSON_A2}`]), personA2],
        body: { bwellPersonId: PERSON_B, externalPersonId: PERSON_A2 },
        missing: `Person/${PERSON_B}`
    },
    {
        operation: 'removePersonToPatientLink',
        stored: [withLinks(personB, [`Patient/${PATIENT_A}`]), patientA],
        body: { personId: PERSON_B, patientId: PATIENT_A },
        missing: `Person/${PERSON_B}`
    },
    {
        operation: 'updatePatientReference',
        stored: [encounterB, patientA2],
        body: { resourceType: 'Encounter', resourceId: ENCOUNTER_B, patientId: PATIENT_A2 },
        missing: `Encounter/${ENCOUNTER_B}`
    }
];

/**
 * The bodies whose looked-up linked resource is stored only in `tenant-b`, for a `tenant-a` caller.
 */
const otherTenantLinkedCases = [
    {
        name: 'createPersonToPatientLink to a Patient in another tenant, with no Person',
        operation: 'createPersonToPatientLink',
        stored: [patientB],
        body: { externalPersonId: MISSING_UUID, patientId: PATIENT_B },
        missing: `Patient/${PATIENT_B}`
    },
    {
        name: 'updatePatientReference to a Patient in another tenant',
        operation: 'updatePatientReference',
        stored: [encounterA, patientB],
        body: { resourceType: 'Encounter', resourceId: ENCOUNTER_A, patientId: PATIENT_B },
        missing: `Patient/${PATIENT_B}`
    }
];

/**
 * Per operation, a target and a linked resource both stored only in `tenant-b`, for a `tenant-a`
 * caller.
 */
const otherTenantBothCases = [
    {
        operation: 'createPersonToPersonLink',
        stored: [personB, personB2],
        body: { bwellPersonId: PERSON_B, externalPersonId: PERSON_B2 },
        missing: `Person/${PERSON_B}`
    },
    {
        operation: 'removePersonToPersonLink',
        stored: [withLinks(personB, [`Person/${PERSON_B2}`]), personB2],
        body: { bwellPersonId: PERSON_B, externalPersonId: PERSON_B2 },
        missing: `Person/${PERSON_B}`
    },
    {
        operation: 'createPersonToPatientLink',
        stored: [withLinks(personB, []), patientB],
        body: { externalPersonId: PERSON_B, patientId: PATIENT_B },
        missing: `Patient/${PATIENT_B}`
    },
    {
        operation: 'removePersonToPatientLink',
        stored: [withLinks(personB, [`Patient/${PATIENT_B}`]), patientB],
        body: { personId: PERSON_B, patientId: PATIENT_B },
        missing: `Person/${PERSON_B}`
    },
    {
        operation: 'updatePatientReference',
        stored: [encounterB, patientB],
        body: { resourceType: 'Encounter', resourceId: ENCOUNTER_B, patientId: PATIENT_B },
        missing: `Encounter/${ENCOUNTER_B}`
    }
];

/**
 * Links added to a stored Person whose target the Person.link check of the result validation
 * refuses, because the add doesn't look the target up: a target that is not stored, one in a
 * tenant the caller can't access, and a bare id that more than one resource the caller can access
 * has. Each answers a 400 with the check's issue code and writes nothing.
 */
const personLinkCheckCases = [
    {
        name: 'createPersonToPersonLink to a Person that is not stored',
        operation: 'createPersonToPersonLink',
        stored: [personA],
        body: { bwellPersonId: PERSON_A, externalPersonId: MISSING_UUID },
        scope: TENANT_A_SCOPE,
        code: 'not-found'
    },
    {
        name: 'createPersonToPatientLink to a Patient that is not stored',
        operation: 'createPersonToPatientLink',
        stored: [personA],
        body: { externalPersonId: PERSON_A, patientId: 'admin-missing-patient' },
        scope: TENANT_A_SCOPE,
        code: 'not-found'
    },
    {
        name: 'createPersonToPersonLink to a Person in another tenant',
        operation: 'createPersonToPersonLink',
        stored: [personA, personB],
        body: { bwellPersonId: PERSON_A, externalPersonId: PERSON_B },
        scope: TENANT_A_SCOPE,
        code: 'forbidden'
    },
    {
        name: 'createPersonToPatientLink to a Patient id stored only in another tenant',
        operation: 'createPersonToPatientLink',
        stored: [personA, patientB],
        body: { externalPersonId: PERSON_A, patientId: patientB.id },
        scope: TENANT_A_SCOPE,
        code: 'forbidden'
    },
    {
        name: 'createPersonToPatientLink to a Patient id stored in two tenants the caller can write',
        operation: 'createPersonToPatientLink',
        stored: [personA, patientA, inTenantOf(patientA, personB)],
        body: { externalPersonId: PERSON_A, patientId: patientA.id },
        scope: TENANT_A_AND_B_WRITE_SCOPE,
        code: 'multiple-matches'
    }
];

/**
 * An add and a remove of the same link by the same ids, the plain ids for a caller with access to
 * every tenant and the `_uuid`s for a `tenant-a` caller: the Person, its link as stored after the
 * add, and the manual-link events of the add and the remove.
 */
const addThenRemoveCases = [
    {
        name: 'Person to Patient by plain ids',
        add: 'createPersonToPatientLink',
        remove: 'removePersonToPatientLink',
        stored: [personA, patientA],
        addBody: { externalPersonId: personA.id, patientId: patientA.id },
        removeBody: { personId: personA.id, patientId: patientA.id },
        scope: ALL_TENANTS_SCOPE,
        storedLink: [`Patient/${patientA.id}`, `Patient/${PATIENT_A}`, `Patient/${patientA.id}`],
        removeMessage: `Removed link from Person/${personA.id} to Patient/${patientA.id}`,
        events: [
            { personId: PERSON_A, patientId: patientA.id, isLinking: true },
            { personId: PERSON_A, patientId: patientA.id, isLinking: false }
        ]
    },
    {
        name: 'Person to Person by plain ids',
        add: 'createPersonToPersonLink',
        remove: 'removePersonToPersonLink',
        stored: [personA, personA2],
        addBody: { bwellPersonId: personA.id, externalPersonId: personA2.id },
        removeBody: { bwellPersonId: personA.id, externalPersonId: personA2.id },
        scope: ALL_TENANTS_SCOPE,
        storedLink: [`Person/${personA2.id}`, `Person/${PERSON_A2}`, `Person/${personA2.id}`],
        removeMessage: `Removed link from Person/${personA.id} to Person/${personA2.id}`,
        events: []
    },
    {
        name: 'Person to Patient by _uuids',
        add: 'createPersonToPatientLink',
        remove: 'removePersonToPatientLink',
        stored: [personA, patientA],
        addBody: { externalPersonId: PERSON_A, patientId: PATIENT_A },
        removeBody: { personId: PERSON_A, patientId: PATIENT_A },
        scope: TENANT_A_SCOPE,
        storedLink: [`Patient/${PATIENT_A}`, `Patient/${PATIENT_A}`, `Patient/${PATIENT_A}`],
        removeMessage: `Removed link from Person/${PERSON_A} to Patient/${PATIENT_A}`,
        events: [
            { personId: PERSON_A, patientId: PATIENT_A, isLinking: true },
            { personId: PERSON_A, patientId: PATIENT_A, isLinking: false }
        ]
    },
    {
        name: 'Person to Person by _uuids',
        add: 'createPersonToPersonLink',
        remove: 'removePersonToPersonLink',
        stored: [personA, personA2],
        addBody: { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 },
        removeBody: { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 },
        scope: TENANT_A_SCOPE,
        storedLink: [`Person/${PERSON_A2}`, `Person/${PERSON_A2}`, `Person/${PERSON_A2}`],
        removeMessage: `Removed link from Person/${PERSON_A} to Person/${PERSON_A2}`,
        events: []
    }
];

describe('admin writes on the shared write pipeline', () => {
    const originalSmartV2Flag = process.env.ENABLE_SMART_V2_CRUDS_SCOPES;

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        if (originalSmartV2Flag === undefined) {
            delete process.env.ENABLE_SMART_V2_CRUDS_SCOPES;
        } else {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = originalSmartV2Flag;
        }
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    afterAll(() => {
        if (originalWritePipelineOperations === undefined) {
            delete process.env.WRITE_PIPELINE_OPERATIONS;
        } else {
            process.env.WRITE_PIPELINE_OPERATIONS = originalWritePipelineOperations;
        }
    });

    describe('success and no-op', () => {
        test.each(successCases)(
            "$operation answers today's success body and stores the change as version 2 with a PATCH history row",
            async ({ operation, stored, body, response, target, stateOf, expectedState }) => {
                const { request } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);

                const result = await adminPost(request, operation, body);

                expect(result.status).toBe(200);
                expect(result.body).toEqual(response);
                const document = await readStoredAsync(target.resourceType, target.uuid);
                expect(stateOf(document)).toEqual(expectedState);
                expect(document.meta.versionId).toBe('2');
                const history = await readHistoryAsync(target.resourceType, target.uuid);
                expect(history.map((row) => row.resource.meta.versionId)).toEqual(['1', '2']);
                expect(history[1].request.method).toBe('PATCH');
            }
        );

        test.each(successCases)(
            '$operation has written an update AuditEvent for the changed resource when it answers',
            async ({ operation, stored, body, target }) => {
                const { request } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);

                const result = await adminPost(request, operation, body);

                expect(result.status).toBe(200);
                expect(summarizeAuditEvents(await readAuditEventsAsync())).toEqual([
                    { action: 'U', references: [`${target.resourceType}/${target.uuid}`] }
                ]);
            }
        );

        test.each(successCases)(
            '$operation sends the manual-link event of its kind, carrying the Patient _uuid',
            async ({ operation, stored, body, linkEvent }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);

                const result = await adminPost(request, operation, body);

                expect(result.status).toBe(200);
                expect(produceEventAsync.mock.calls.map(([event]) => event)).toEqual(
                    linkEvent ? [linkEvent] : []
                );
            }
        );

        test.each(noOpCases)(
            "$name answers today's no-op body and writes nothing",
            async ({ operation, stored, body, response }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body);

                expect(result.status).toBe(200);
                expect(result.body).toEqual(response);
                expect(await snapshotAsync()).toEqual(before);
                expect(await readAuditEventsAsync()).toEqual([]);
                expect(produceEventAsync).not.toHaveBeenCalled();
            }
        );
    });

    describe('createPersonToPatientLink with no stored Person', () => {
        test("creates a Person with a generated id, the Patient's meta.source and meta.security, one link to the Patient and a POST history row", async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA]);

            const result = await adminPost(request, 'createPersonToPatientLink', {
                externalPersonId: MISSING_UUID,
                patientId: PATIENT_A
            });

            expect(result.status).toBe(200);
            expect(result.body).toEqual({
                message: `Created Person and added link from Person/${MISSING_UUID} to Patient/${PATIENT_A}`,
                patientId: PATIENT_A,
                externalPersonId: MISSING_UUID
            });
            const persons = await (await collectionOf('Person')).find({}).toArray();
            expect(persons).toHaveLength(1);
            const [person] = persons;
            expect(isUuid(person._uuid)).toBeTruthy();
            expect(person._uuid).not.toBe(MISSING_UUID);
            expect(person.id).toBe(person._uuid);
            expect(person.meta.source).toBe(patientA.meta.source);
            expect(
                person.meta.security
                    .filter((tag) => tag.system === OWNER_SYSTEM || tag.system.endsWith('/access'))
                    .map(({ system, code }) => ({ system, code }))
            ).toEqual(patientA.meta.security);
            expect(linkUuids(person)).toEqual([`Patient/${PATIENT_A}`]);
            expect(person.meta.versionId).toBe('1');
            const history = await readHistoryAsync('Person', person._uuid);
            expect(history).toHaveLength(1);
            expect(history[0].request.method).toBe('POST');
        });

        test("links the Patient by the plain id as sent and sends the Patient's _uuid in the linking event", async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA]);

            const result = await adminPost(
                request,
                'createPersonToPatientLink',
                { externalPersonId: MISSING_UUID, patientId: `Patient/${patientA.id}` },
                ALL_TENANTS_SCOPE
            );

            expect(result.status).toBe(200);
            const [person] = await (await collectionOf('Person')).find({}).toArray();
            expect(linkFields(person)).toEqual([
                [`Patient/${patientA.id}`, `Patient/${PATIENT_A}`, `Patient/${patientA.id}`]
            ]);
            expect(produceEventAsync.mock.calls.map(([event]) => event)).toEqual([
                { personId: person._uuid, patientId: PATIENT_A, isLinking: true }
            ]);
        });

        test('has written a create AuditEvent for the new Person when it answers', async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA]);

            const result = await adminPost(request, 'createPersonToPatientLink', {
                externalPersonId: MISSING_UUID,
                patientId: PATIENT_A
            });

            expect(result.status).toBe(200);
            const [person] = await (await collectionOf('Person')).find({}).toArray();
            expect(summarizeAuditEvents(await readAuditEventsAsync())).toEqual([
                { action: 'C', references: [`Person/${person._uuid}`] }
            ]);
        });

        test("sends a linking event with the new Person's _uuid and the Patient's _uuid", async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA]);

            const result = await adminPost(request, 'createPersonToPatientLink', {
                externalPersonId: MISSING_UUID,
                patientId: PATIENT_A
            });

            expect(result.status).toBe(200);
            const [person] = await (await collectionOf('Person')).find({}).toArray();
            expect(produceEventAsync.mock.calls.map(([event]) => event)).toEqual([
                { personId: person._uuid, patientId: PATIENT_A, isLinking: true }
            ]);
        });

        test('is forbidden, and creates nothing, for a caller without create access to the tenant', async () => {
            process.env.ENABLE_SMART_V2_CRUDS_SCOPES = '1';
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA]);
            const before = await snapshotAsync();

            const result = await adminPost(
                request,
                'createPersonToPatientLink',
                { externalPersonId: MISSING_UUID, patientId: PATIENT_A },
                TENANT_A_WITHOUT_CREATE_SCOPE
            );

            expectOperationOutcome(result, 403, 'forbidden');
            await expectNothingWrittenAsync({ before, produceEventAsync });
        });

        test("leaves a Person in another tenant with the requested _uuid unchanged and creates a new Person in the caller's tenant", async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [personB, patientA]);
            const storedPersonB = await readStoredAsync('Person', PERSON_B);

            const result = await adminPost(request, 'createPersonToPatientLink', {
                externalPersonId: PERSON_B,
                patientId: PATIENT_A
            });

            expect(result.status).toBe(200);
            expect(result.body.message).toBe(
                `Created Person and added link from Person/${PERSON_B} to Patient/${PATIENT_A}`
            );
            expect(await readStoredAsync('Person', PERSON_B)).toEqual(storedPersonB);
            expect(await readHistoryAsync('Person', PERSON_B)).toHaveLength(1);
            const created = await (
                await collectionOf('Person')
            )
                .find({ _uuid: { $ne: PERSON_B } })
                .toArray();
            expect(created).toHaveLength(1);
            expect(created[0]._sourceAssigningAuthority).toBe('tenant-a');
        });
    });

    describe('createPersonToPatientLink with a stored Person the caller can read but not update', () => {
        test("is refused with 403 forbidden and writes nothing, for a caller that may only read the Person's tenant and may write the Patient's tenant", async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [personA, patientB]);
            const before = await snapshotAsync();

            const result = await adminPost(
                request,
                'createPersonToPatientLink',
                { externalPersonId: PERSON_A, patientId: PATIENT_B },
                TENANT_A_READ_TENANT_B_WRITE_SCOPE
            );

            expectOperationOutcome(result, 403, 'forbidden');
            await expectNothingWrittenAsync({ before, produceEventAsync });
        });
    });

    describe('ids and parameters', () => {
        test.each(plainIdCases)(
            '$operation accepts plain ids ($form), answers with them, links them as sent and points a patient reference at the _uuid',
            async ({ operation, stored, body, scope, response, target, stateOf, expectedState, linkEvent }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);

                const result = await adminPost(request, operation, body, scope);

                expect(result.status).toBe(200);
                expect(result.body).toEqual(response);
                const document = await readStoredAsync(target.resourceType, target.uuid);
                expect(stateOf(document)).toEqual(expectedState);
                expect(document.meta.versionId).toBe('2');
                expect(produceEventAsync.mock.calls.map(([event]) => event)).toEqual(
                    linkEvent ? [linkEvent] : []
                );
            }
        );

        test.each(idWithAuthorityCases)(
            '$operation accepts id|authority and writes the resource with that _uuid',
            async ({ operation, stored, body, target, stateOf, expectedState }) => {
                const { request } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);

                const result = await adminPost(request, operation, body);

                expect(result.status).toBe(200);
                const document = await readStoredAsync(target.resourceType, target.uuid);
                expect(stateOf(document)).toEqual(expectedState);
            }
        );

        test.each(ambiguousIdCases)(
            '$name answers 400 invalid asking for the _uuid, to a caller with access to both tenants, and writes nothing',
            async ({ operation, stored, body, message }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body, ALL_TENANTS_SCOPE);

                expectOperationOutcome(result, 400, 'invalid');
                expect(result.body.issue[0].details.text).toBe(message);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each(ambiguousIdCases)(
            '$name is written on the tenant-a resource for a tenant-a caller, who sees only that one',
            async ({ operation, stored, body, tenantAWrite }) => {
                const { request } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const untouchedBefore = tenantAWrite.untouched &&
                    (await readStoredAsync(tenantAWrite.resourceType, tenantAWrite.untouched));

                const result = await adminPost(request, operation, body);

                expect(result.status).toBe(200);
                const document = await readStoredAsync(tenantAWrite.resourceType, tenantAWrite.uuid);
                expect(document.meta.versionId).toBe('2');
                if (tenantAWrite.untouched) {
                    expect(
                        await readStoredAsync(tenantAWrite.resourceType, tenantAWrite.untouched)
                    ).toEqual(untouchedBefore);
                }
            }
        );

        test.each(unsafeIdCases)(
            '$operation answers 400 invalid for $name, without echoing it, and writes nothing',
            async ({ operation, stored, body }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body, ALL_TENANTS_SCOPE);

                expectOperationOutcome(result, 400, 'invalid');
                const text = result.body.issue[0].details.text;
                expect(text).toMatch(/^Invalid \w+: /);
                for (const value of Object.values(body)) {
                    expect(text).not.toContain(value);
                }
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test('an id of 255 characters is accepted and looked up, and is not found', async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [personA2]);
            const before = await snapshotAsync();
            const longId = 'p'.repeat(255);

            const result = await adminPost(request, 'createPersonToPersonLink', {
                bwellPersonId: longId,
                externalPersonId: PERSON_A2
            });

            expectOperationOutcome(result, 404, 'not-found');
            expect(result.body.issue[0].details.text).toBe(`Resource not found: Person/${longId}`);
            await expectNothingWrittenAsync({ before, produceEventAsync });
        });

        test.each(prefixedIdCases)(
            '$operation accepts Person/ and Patient/ prefixes on the ids and answers with them stripped',
            async ({ operation, stored, body, response, target, stateOf, expectedState }) => {
                const { request } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);

                const result = await adminPost(request, operation, body);

                expect(result.status).toBe(200);
                expect(result.body).toEqual(response);
                const document = await readStoredAsync(target.resourceType, target.uuid);
                expect(stateOf(document)).toEqual(expectedState);
            }
        );

        test.each(missingParameterCases)(
            '$operation answers a standard 400 invalid OperationOutcome for a missing parameter',
            async ({ operation, body }) => {
                const { request } = await createRequestWithEventSpyAsync();

                const result = await adminPost(request, operation, body);

                expectOperationOutcome(result, 400, 'invalid');
            }
        );

        test('updatePatientReference answers 400 invalid for a resource type that is not supported', async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA2]);
            const before = await snapshotAsync();

            const result = await adminPost(request, 'updatePatientReference', {
                resourceType: 'NotAResourceType',
                resourceId: ENCOUNTER_A,
                patientId: PATIENT_A2
            });

            expectOperationOutcome(result, 400, 'invalid');
            expect(result.body.issue[0].details.text).toBe(
                'ResourceType NotAResourceType not supported'
            );
            await expectNothingWrittenAsync({ before, produceEventAsync });
        });
    });

    describe('links added to a stored Person by the id as sent', () => {
        test.each(addThenRemoveCases)(
            '$name: the add stores the link as sent and the remove by the same ids removes it',
            async ({ add, remove, stored, addBody, removeBody, scope, storedLink, removeMessage, events }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);

                const added = await adminPost(request, add, addBody, scope);
                const afterAdd = await readStoredAsync('Person', PERSON_A);
                const removed = await adminPost(request, remove, removeBody, scope);

                expect(added.status).toBe(200);
                expect(linkFields(afterAdd)).toEqual([storedLink]);
                expect(removed.status).toBe(200);
                expect(removed.body.message).toBe(removeMessage);
                const afterRemove = await readStoredAsync('Person', PERSON_A);
                expect(afterRemove.link ?? []).toEqual([]);
                expect(afterRemove.meta.versionId).toBe('3');
                const history = await readHistoryAsync('Person', PERSON_A);
                expect(history.map((row) => row.resource.meta.versionId)).toEqual(['1', '2', '3']);
                expect(produceEventAsync.mock.calls.map(([event]) => event)).toEqual(events);
            }
        );

        test.each([
            {
                operation: 'createPersonToPatientLink',
                stored: [personA, patientA],
                body: { externalPersonId: personA.id, patientId: patientA.id },
                message: `Link already exists from Person/${personA.id} to Patient/${patientA.id}`
            },
            {
                operation: 'createPersonToPersonLink',
                stored: [personA, personA2],
                body: { bwellPersonId: personA.id, externalPersonId: personA2.id },
                message: `Link already exists from ${personA.id} to ${personA2.id}`
            }
        ])(
            '$operation repeated with the same plain id answers today\'s no-op body and writes nothing',
            async ({ operation, stored, body, message }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                expect((await adminPost(request, operation, body, ALL_TENANTS_SCOPE)).status).toBe(200);
                produceEventAsync.mockClear();
                const { auditLogger, mongoDatabaseManager } = getTestContainer();
                await auditLogger.flushAsync();
                await (await mongoDatabaseManager.getAuditDbAsync())
                    .collection('AuditEvent_4_0_0')
                    .deleteMany({});
                const before = await snapshotAsync();

                const repeated = await adminPost(request, operation, body, ALL_TENANTS_SCOPE);

                expect(repeated.status).toBe(200);
                expect(repeated.body.message).toBe(message);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each([
            {
                name: 'the link was stored as sent with an authority',
                links: [`Patient/${patientA.id}|tenant-a`],
                body: { personId: personA.id, patientId: `${patientA.id}|tenant-a` }
            },
            {
                name: 'the link was stored by _uuid',
                links: [`Patient/${PATIENT_A}`],
                body: { personId: personA.id, patientId: PATIENT_A }
            }
        ])('removePersonToPatientLink removes a link when $name and the same text is sent', async ({ links, body }) => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [withLinks(personA, links), patientA]);

            const result = await adminPost(request, 'removePersonToPatientLink', body);

            expect(result.status).toBe(200);
            expect(result.body.message).toMatch(/^Removed link/);
            expect((await readStoredAsync('Person', PERSON_A)).link ?? []).toEqual([]);
        });

        test.each(personLinkCheckCases)(
            '$name is refused by the Person.link check with 400 $code and writes nothing',
            async ({ operation, stored, body, scope, code }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body, scope);

                expectOperationOutcome(result, 400, code);
                expect(result.body.issue[0].details.text).toMatch(/^Person\.link target /);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test('a caller with access to every tenant skips the Person.link check: a bare Patient id stored in two tenants is linked as sent, and preSave names it in the Person\'s tenant', async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [personA, patientA, inTenantOf(patientA, personB)]);

            const result = await adminPost(
                request,
                'createPersonToPatientLink',
                { externalPersonId: PERSON_A, patientId: patientA.id },
                ALL_TENANTS_SCOPE
            );

            expect(result.status).toBe(200);
            expect(linkFields(await readStoredAsync('Person', PERSON_A))).toEqual([
                [`Patient/${patientA.id}`, `Patient/${PATIENT_A}`, `Patient/${patientA.id}`]
            ]);
        });

        test('a created Person for a Patient id stored in two tenants the caller can read answers 400 invalid asking for the _uuid and writes nothing', async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA, inTenantOf(patientA, personB)]);
            const before = await snapshotAsync();

            const result = await adminPost(
                request,
                'createPersonToPatientLink',
                { externalPersonId: MISSING_UUID, patientId: patientA.id },
                ALL_TENANTS_SCOPE
            );

            expectOperationOutcome(result, 400, 'invalid');
            expect(result.body.issue[0].details.text).toBe(
                'The id matches more than one Patient; pass the _uuid'
            );
            await expectNothingWrittenAsync({ before, produceEventAsync });
        });
    });

    describe('not found and tenant isolation', () => {
        test.each(missingTargetCases)(
            '$operation answers 404 for a target that is not stored and writes nothing',
            async ({ operation, stored, body, missing }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body);

                expectOperationOutcome(result, 404, 'not-found');
                expect(result.body.issue[0].details.text).toBe(`Resource not found: ${missing}`);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test('a write that fails with 404 logs one error AuditEvent with the status text', async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [patientA2]);

            const result = await adminPost(request, 'updatePatientReference', {
                resourceType: 'Encounter',
                resourceId: MISSING_UUID,
                patientId: PATIENT_A2
            });

            expectOperationOutcome(result, 404, 'not-found');
            const errorAuditEvents = await readErrorAuditEventsAsync();
            expect(
                errorAuditEvents.map((auditEvent) => ({
                    outcome: auditEvent.outcome,
                    outcomeDesc: auditEvent.outcomeDesc,
                    requestUrl: auditEvent.entity[0].detail.find(
                        (detail) => detail.type === 'requestUrl'
                    ).valueString
                }))
            ).toEqual([
                { outcome: '4', outcomeDesc: 'Not Found', requestUrl: '/admin/updatePatientReference' }
            ]);
        });

        test.each(missingLinkedCases)(
            '$name answers 404 and writes nothing',
            async ({ operation, stored, body, missing }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body);

                expectOperationOutcome(result, 404, 'not-found');
                expect(result.body.issue[0].details.text).toBe(`Resource not found: ${missing}`);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each(otherTenantTargetCases)(
            '$operation answers 404 to a tenant-a caller for a target stored only in tenant-b and writes nothing',
            async ({ operation, stored, body, missing }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body);

                expectOperationOutcome(result, 404, 'not-found');
                expect(result.body.issue[0].details.text).toBe(`Resource not found: ${missing}`);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each(otherTenantLinkedCases)(
            '$name answers 404 to a tenant-a caller and writes nothing',
            async ({ operation, stored, body, missing }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body);

                expectOperationOutcome(result, 404, 'not-found');
                expect(result.body.issue[0].details.text).toBe(`Resource not found: ${missing}`);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each(otherTenantPlainIdCases)(
            '$name answers 404 to a tenant-a caller and writes nothing',
            async ({ operation, stored, body, missing }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body);

                expectOperationOutcome(result, 404, 'not-found');
                expect(result.body.issue[0].details.text).toBe(`Resource not found: ${missing}`);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each(otherTenantBothCases)(
            '$operation answers 404 to a tenant-a caller when the target and the linked resource are both in tenant-b and writes nothing',
            async ({ operation, stored, body, missing }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body);

                expectOperationOutcome(result, 404, 'not-found');
                expect(result.body.issue[0].details.text).toBe(`Resource not found: ${missing}`);
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );
    });

    describe('Person link to a Person in another tenant', () => {
        test('is refused for a caller that can read but not write the other tenant, and writes nothing', async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [personA, personB]);
            const before = await snapshotAsync();

            const result = await adminPost(
                request,
                'createPersonToPersonLink',
                { bwellPersonId: PERSON_A, externalPersonId: PERSON_B },
                TENANT_A_WRITE_TENANT_B_READ_SCOPE
            );

            expectOperationOutcome(result, 400, 'forbidden');
            expect(result.body.issue[0].details.text).toBe(
                `Person.link target Person/${PERSON_B} belongs to a tenant the caller does not have access to.`
            );
            await expectNothingWrittenAsync({ before, produceEventAsync });
        });

        test('is allowed for a caller with access to every tenant', async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [personA, personB]);

            const result = await adminPost(
                request,
                'createPersonToPersonLink',
                { bwellPersonId: PERSON_A, externalPersonId: PERSON_B },
                ALL_TENANTS_SCOPE
            );

            expect(result.status).toBe(200);
            expect(result.body.message).toBe(
                `Added link from Person/${PERSON_A} to Person/${PERSON_B}`
            );
            expect(linkUuids(await readStoredAsync('Person', PERSON_A))).toEqual([
                `Person/${PERSON_B}`
            ]);
        });
    });

    describe('updatePatientReference', () => {
        test('points the subject at the new Patient and recomputes its _uuid, _sourceId and _sourceAssigningAuthority', async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [encounterA, patientA2]);
            expect(subjectFields(await readStoredAsync('Encounter', ENCOUNTER_A))).toEqual({
                reference: 'Patient/admin-patient-old|tenant-c',
                _uuid: `Patient/${generateUUIDv5('admin-patient-old|tenant-c')}`,
                _sourceId: 'Patient/admin-patient-old',
                _sourceAssigningAuthority: 'tenant-c'
            });

            const result = await adminPost(request, 'updatePatientReference', {
                resourceType: 'Encounter',
                resourceId: ENCOUNTER_A,
                patientId: PATIENT_A2
            });

            expect(result.status).toBe(200);
            expect(subjectFields(await readStoredAsync('Encounter', ENCOUNTER_A))).toEqual({
                reference: `Patient/${PATIENT_A2}`,
                _uuid: `Patient/${PATIENT_A2}`,
                _sourceId: `Patient/${PATIENT_A2}`,
                _sourceAssigningAuthority: patientA2.meta.security[0].code
            });
        });

        test("is refused with 403 forbidden for a caller that can read but not write the new Patient's tenant, and writes nothing", async () => {
            const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [encounterA, patientB]);
            const before = await snapshotAsync();

            const result = await adminPost(
                request,
                'updatePatientReference',
                { resourceType: 'Encounter', resourceId: ENCOUNTER_A, patientId: PATIENT_B },
                TENANT_A_WRITE_TENANT_B_READ_SCOPE
            );

            expectOperationOutcome(result, 403, 'forbidden');
            await expectNothingWrittenAsync({ before, produceEventAsync });
        });

        test("points the subject at a Patient in another tenant for a caller with write access to both tenants", async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [encounterA, patientB]);

            const result = await adminPost(
                request,
                'updatePatientReference',
                { resourceType: 'Encounter', resourceId: ENCOUNTER_A, patientId: PATIENT_B },
                TENANT_A_AND_B_WRITE_SCOPE
            );

            expect(result.status).toBe(200);
            expect((await readStoredAsync('Encounter', ENCOUNTER_A)).subject._uuid).toBe(
                `Patient/${PATIENT_B}`
            );
        });

        const refusedChanges = [
            {
                method: 'PUT',
                send: (request) =>
                    request
                        .put(`/4_0_0/Encounter/${encounterA.id}`)
                        .send(withSubject(encounterA, { reference: `Patient/${PATIENT_A2}` }))
                        .set(getHeaders()),
                check: (result) => expectOperationOutcome(result, 400, 'invalid')
            },
            {
                method: 'PATCH',
                send: (request) =>
                    request
                        .patch(`/4_0_0/Encounter/${ENCOUNTER_A}`)
                        .send([
                            {
                                op: 'replace',
                                path: '/subject/reference',
                                value: `Patient/${PATIENT_A2}`
                            }
                        ])
                        .set(getHeadersJsonPatch()),
                check: (result) => expectOperationOutcome(result, 400, 'invalid')
            },
            {
                method: '$merge',
                send: (request) =>
                    request
                        .post('/4_0_0/Encounter/$merge')
                        .send(withSubject(encounterA, { reference: `Patient/${PATIENT_A2}` }))
                        .set(getHeaders()),
                check: (result) => {
                    expect(result.status).toBe(200);
                    expect(result.body).toMatchObject({ created: false, updated: false });
                    expect(result.body.issue).toMatchObject({ code: 'invalid' });
                }
            }
        ];

        test.each(refusedChanges)(
            'the same change through $method is still refused and leaves the Encounter unchanged',
            async ({ send, check }) => {
                const { request } = await createRequestWithEventSpyAsync();
                await storeAsync(request, [encounterA, patientA2]);
                const storedEncounter = await readStoredAsync('Encounter', ENCOUNTER_A);

                const result = await send(request);

                check(result);
                await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
                    timeoutInSeconds: 20
                });
                expect(await readStoredAsync('Encounter', ENCOUNTER_A)).toEqual(storedEncounter);
                expect(await readHistoryAsync('Encounter', ENCOUNTER_A)).toHaveLength(1);
            }
        );
    });

    describe('admin scope and error format', () => {
        test.each(successCases)(
            '$operation answers 403 forbidden for an admin scope that does not allow writes and writes nothing',
            async ({ operation, stored, body }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body, ADMIN_READ_ONLY_SCOPE);

                expectOperationOutcome(result, 403, 'forbidden');
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each(successCases)(
            '$operation answers 403 forbidden for a token with no admin scope and writes nothing',
            async ({ operation, stored, body }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();

                const result = await adminPost(request, operation, body, NO_ADMIN_SCOPE);

                expectOperationOutcome(result, 403, 'forbidden');
                expect(result.body.issue[0].details.text).toBe(
                    'user does not have access to this admin route'
                );
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );

        test.each(successCases)(
            '$operation answers 500 with Internal Server Error when the database fails and writes nothing',
            async ({ operation, stored, body }) => {
                const { request, produceEventAsync } = await createRequestWithEventSpyAsync();
                await storeAsync(request, stored);
                const before = await snapshotAsync();
                const { databaseQueryFactory } = getTestContainer();
                const createQuery = databaseQueryFactory.createQuery.bind(databaseQueryFactory);
                const createQuerySpy = jest
                    .spyOn(databaseQueryFactory, 'createQuery')
                    .mockImplementation((args) => {
                        const query = createQuery(args);
                        query.findAsync = () => Promise.reject(new Error('database unavailable'));
                        return query;
                    });

                const result = await adminPost(request, operation, body);

                createQuerySpy.mockRestore();
                expectOperationOutcome(result, 500, 'internal');
                expect(result.body.issue[0].details.text).toBe('Internal Server Error');
                expect(JSON.stringify(result.body)).not.toContain('database unavailable');
                await expectNothingWrittenAsync({ before, produceEventAsync });
            }
        );
    });

    describe('concurrency', () => {
        /**
         * Checks that Person A was written once: history versions 1 and 2 only, and one update
         * AuditEvent, because the losing request writes nothing.
         */
        const expectOneWriteOfPersonAAsync = async () => {
            await getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({
                timeoutInSeconds: 20
            });
            const history = await readHistoryAsync('Person', PERSON_A);
            expect(history.map((row) => row.resource.meta.versionId)).toEqual(['1', '2']);
            expect(summarizeAuditEvents(await readAuditEventsAsync())).toEqual([
                { action: 'U', references: [`Person/${PERSON_A}`] }
            ]);
        };

        test('two concurrent adds of the same Person link leave one link and both succeed', async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [personA, personA2]);
            const body = { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 };

            const results = await Promise.all([
                adminPost(request, 'createPersonToPersonLink', body),
                adminPost(request, 'createPersonToPersonLink', body)
            ]);

            expect(results.map((result) => result.status)).toEqual([200, 200]);
            expect(linkUuids(await readStoredAsync('Person', PERSON_A))).toEqual([
                `Person/${PERSON_A2}`
            ]);
            await expectOneWriteOfPersonAAsync();
        });

        test('two concurrent removes of the same Person link leave none and both succeed', async () => {
            const { request } = await createRequestWithEventSpyAsync();
            await storeAsync(request, [withLinks(personA, [`Person/${PERSON_A2}`]), personA2]);
            const body = { bwellPersonId: PERSON_A, externalPersonId: PERSON_A2 };

            const results = await Promise.all([
                adminPost(request, 'removePersonToPersonLink', body),
                adminPost(request, 'removePersonToPersonLink', body)
            ]);

            expect(results.map((result) => result.status)).toEqual([200, 200]);
            expect(linkUuids(await readStoredAsync('Person', PERSON_A))).toEqual([]);
            await expectOneWriteOfPersonAAsync();
        });
    });
});
