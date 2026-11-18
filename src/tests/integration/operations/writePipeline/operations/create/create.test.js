const patientResource = require('./fixtures/patient.json');
const patientLastUpdatedNotAnInstantResource = require('./fixtures/patientLastUpdatedNotAnInstant.json');
const patientOtherTenantResource = require('./fixtures/patientOtherTenant.json');
const patientTwoAccessTagsResource = require('./fixtures/patientTwoAccessTags.json');
const patientWithoutOwnerResource = require('./fixtures/patientWithoutOwner.json');
const patientInvalidBirthDateResource = require('./fixtures/patientInvalidBirthDate.json');
const patientInvalidBirthDateWithoutOwnerResource = require(
    './fixtures/patientInvalidBirthDateWithoutOwner.json'
);
const observationResource = require('./fixtures/observation.json');
const observationWithoutMetaSourceResource = require('./fixtures/observationWithoutMetaSource.json');
const observationOtherPatientResource = require('./fixtures/observationOtherPatient.json');
const personResource = require('./fixtures/person.json');
const personLinkOtherTenantResource = require('./fixtures/personLinkOtherTenant.json');
const personLinkOtherTenantTwoAccessTagsResource = require(
    './fixtures/personLinkOtherTenantTwoAccessTags.json'
);
const auditEventResource = require('./fixtures/auditEvent.json');
const auditEventWithoutMetaSourceResource = require('./fixtures/auditEventWithoutMetaSource.json');
const auditEventInvalidRecordedResource = require('./fixtures/auditEventInvalidRecorded.json');
const auditEventTwoAccessTagsResource = require('./fixtures/auditEventTwoAccessTags.json');
const documentReferenceAttachmentResource = require('./fixtures/documentReferenceAttachment.json');
const documentReferenceInternalFieldsResource = require('./fixtures/documentReferenceInternalFields.json');
const groupOverLimitWithInvalidFieldResource = require(
    './fixtures/groupOverLimitWithInvalidField.json'
);

const expectedCreated = require('./fixtures/expected/created.json');
const expectedStoredCreated = require('./fixtures/expected/storedCreated.json');
const expectedClientIdAndInternalFields = require('./fixtures/expected/clientIdAndInternalFields.json');
const expectedStoredClientIdAndInternalFields = require('./fixtures/expected/storedClientIdAndInternalFields.json');
const expectedLastUpdatedNotAnInstant = require('./fixtures/expected/lastUpdatedNotAnInstant.json');
const expectedArrayBody = require('./fixtures/expected/arrayBody.json');
const expectedTypeMismatch = require('./fixtures/expected/typeMismatch.json');
const expectedTypeMismatchWithoutMetaSourceOldPath = require(
    './fixtures/expected/typeMismatchWithoutMetaSourceOldPath.json'
);
const expectedTypeMismatchWithoutMetaSourceNewPath = require(
    './fixtures/expected/typeMismatchWithoutMetaSourceNewPath.json'
);
const expectedEmptyBodyOldPath = require('./fixtures/expected/emptyBodyOldPath.json');
const expectedEmptyBodyNewPath = require('./fixtures/expected/emptyBodyNewPath.json');
const expectedMissingOwner = require('./fixtures/expected/missingOwner.json');
const expectedInvalidSchema = require('./fixtures/expected/invalidSchema.json');
const expectedInvalidSchemaWithoutOwnerOldPath = require(
    './fixtures/expected/invalidSchemaWithoutOwnerOldPath.json'
);
const expectedInvalidSchemaWithoutOwnerNewPath = require(
    './fixtures/expected/invalidSchemaWithoutOwnerNewPath.json'
);
const expectedAuditEventTooLarge = require('./fixtures/expected/auditEventTooLarge.json');
const expectedAuditEventTooLargeWithoutMetaSourceOldPath = require(
    './fixtures/expected/auditEventTooLargeWithoutMetaSourceOldPath.json'
);
const expectedAuditEventTooLargeWithoutMetaSourceNewPath = require(
    './fixtures/expected/auditEventTooLargeWithoutMetaSourceNewPath.json'
);
const expectedAuditEventTooLargeInvalidSchemaOldPath = require(
    './fixtures/expected/auditEventTooLargeInvalidSchemaOldPath.json'
);
const expectedAuditEventTooLargeInvalidSchemaNewPath = require(
    './fixtures/expected/auditEventTooLargeInvalidSchemaNewPath.json'
);
const expectedAuditEventCreated = require('./fixtures/expected/auditEventCreated.json');
const expectedNoScope = require('./fixtures/expected/noScope.json');
const expectedOtherTenant = require('./fixtures/expected/otherTenant.json');
const expectedAccessTagNotGrantable = require('./fixtures/expected/accessTagNotGrantable.json');
const expectedPersonLinkOtherTenant = require('./fixtures/expected/personLinkOtherTenant.json');
const expectedPersonLinkOtherTenantTagNotGrantableOldPath = require(
    './fixtures/expected/personLinkOtherTenantTagNotGrantableOldPath.json'
);
const expectedPersonLinkOtherTenantTagNotGrantableNewPath = require(
    './fixtures/expected/personLinkOtherTenantTagNotGrantableNewPath.json'
);
const expectedPatientScopeOwn = require('./fixtures/expected/patientScopeOwn.json');
const expectedPatientScopeOther = require('./fixtures/expected/patientScopeOther.json');
const expectedAttachmentStored = require('./fixtures/expected/attachmentStored.json');
const expectedStoredAttachmentStored = require('./fixtures/expected/storedAttachmentStored.json');
const expectedGroupOverLimitWithInvalidFieldOldPath = require(
    './fixtures/expected/groupOverLimitWithInvalidFieldOldPath.json'
);
const expectedGroupOverLimitWithInvalidFieldNewPath = require(
    './fixtures/expected/groupOverLimitWithInvalidFieldNewPath.json'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { WritePipeline } = require('../../../../../../operations/writePipeline/writePipeline');
const { generateUUIDv5, isUuid } = require('../../../../../../utils/uid.util');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The environment variables a case or a path switch may change, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'AUDIT_EVENT_MAX_SIZE_BYTES',
    'ENABLE_EXTENDED_GROUP',
    'GROUP_MEMBER_PROMOTION_LIMIT'
];

/**
 * The id every generated resource id is replaced with before a response is compared to its golden.
 */
const GOLDEN_ID = '00000000-0000-4000-8000-000000000001';

/**
 * The shape of a full instant, which is what the server stamps on `meta.lastUpdated`.
 */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Posts the body to the create endpoint of the resource type with the given headers.
 */
const createResource = (request, resourceType, body, headers = getHeaders()) =>
    request.post(`/4_0_0/${resourceType}/`).send(body).set(headers);

/**
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

/**
 * Sends POST to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (path) => {
    process.env.WRITE_PIPELINE_OPERATIONS = path === 'new' ? 'create' : '';
};

/**
 * Expands each case into one run per path: both paths, or only the paths in its `paths` list.
 */
const withEachPath = (cases) =>
    cases.flatMap((testCase) => (testCase.paths ?? PATHS).map((path) => ({ ...testCase, path })));

/**
 * Returns the golden a case's response is compared to on the given path: the case's
 * `goldenByPath` entry for that path when it has one, else its `expected` golden.
 */
const goldenFor = ({ expected, goldenByPath, path }) => goldenByPath?.[path] ?? expected;

/**
 * Returns the status a case's response must have on the given path: the case's `statusByPath`
 * entry for that path when it has one, else its `status`.
 */
const statusFor = ({ status, statusByPath, path }) => statusByPath?.[path] ?? status;

/**
 * Returns a copy of the body with every occurrence of the generated id replaced by the golden id.
 */
const withGoldenId = (body, generatedId) =>
    JSON.parse(JSON.stringify(body).replaceAll(generatedId, GOLDEN_ID));

/**
 * Returns a copy of a failure body with every uuid in it replaced by the golden id, because the
 * failure messages name the id the server generated for the rejected resource.
 */
const withGoldenIdsMasked = (body) =>
    JSON.parse(
        JSON.stringify(body).replace(/[^\s"/]+/g, (token) => (isUuid(token) ? GOLDEN_ID : token))
    );

/**
 * Returns the resource types a rejected POST must not have stored: the type in the URL and the
 * type of each resource in the body.
 */
const typesThatMustNotBeStored = (urlType, body) => [
    ...new Set([urlType, ...[].concat(body ?? []).map((resource) => resource.resourceType)])
];

/**
 * Reads every document stored in the resource type's collection straight from the MongoDB
 * database the server writes that resource type to (the audit database for AuditEvent).
 */
const readStoredDocuments = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    return db.collection(`${resourceType}_4_0_0`).find({}).toArray();
};

/**
 * Reads the id of every file stored in GridFS straight from MongoDB.
 */
const readGridFsFileIds = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    const files = await db.collection('fs.files').find({}).toArray();
    return files.map((file) => file._id.toString());
};

/**
 * The headers of a patient-scoped caller whose own Person is the one stored by the cases.
 */
const patientScopeHeaders = getHeadersWithCustomPayload({
    scope: 'patient/Observation.write',
    username: 'parity-patient-user',
    clientFhirPersonId: generateUUIDv5('parity-person-1|client'),
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: generateUUIDv5('parity-person-1|client'),
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
});

/**
 * The headers of a full-scope POST that sends no body. The server does not parse an
 * `application/fhir+ndjson` body, so the operation gets no body, as for a request without
 * `Content-Length`.
 */
const noBodyHeaders = { ...getHeaders(), 'Content-Type': 'application/fhir+ndjson' };

describe('POST parity between the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
    );

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'created',
            type: 'Patient',
            body: patientResource,
            status: 201,
            expected: expectedCreated,
            stored: expectedStoredCreated
        },
        {
            name: 'returnMinimal',
            type: 'Patient',
            body: patientResource,
            headers: { ...getHeaders(), Prefer: 'return=minimal' },
            status: 201,
            expected: {},
            stored: expectedStoredCreated
        },
        {
            name: 'clientIdAndInternalFields',
            type: 'DocumentReference',
            body: documentReferenceInternalFieldsResource,
            status: 201,
            expected: expectedClientIdAndInternalFields,
            stored: expectedStoredClientIdAndInternalFields,
            assertStoredDocuments: ({ documents, gridFsFileIds, id }) => {
                expect(documents).toHaveLength(1);
                const [document] = documents;
                expect(document.id).toBe(id);
                expect(document._uuid).toBe(id);
                expect(document._sourceId).toBe(id);
                expect(document._sourceAssigningAuthority).toBe('client');
                expect(document._access).toStrictEqual({ client: 1 });
                expect(gridFsFileIds).toHaveLength(1);
                const [withoutData, withData] = document.content.map((item) => item.attachment);
                expect(withoutData).toStrictEqual({ contentType: 'text/plain' });
                expect(withData).toStrictEqual({
                    contentType: 'text/plain',
                    _file_id: gridFsFileIds[0]
                });
            }
        },
        {
            name: 'lastUpdatedNotAnInstant',
            type: 'Patient',
            body: patientLastUpdatedNotAnInstantResource,
            status: 201,
            expected: expectedLastUpdatedNotAnInstant
        },
        {
            name: 'arrayBody',
            type: 'Patient',
            body: [patientResource, patientResource],
            status: 400,
            expected: expectedArrayBody
        },
        {
            name: 'typeMismatch',
            type: 'Patient',
            body: observationResource,
            status: 400,
            expected: expectedTypeMismatch
        },
        {
            name: 'typeMismatchWithoutMetaSource',
            type: 'Patient',
            body: observationWithoutMetaSourceResource,
            status: 400,
            goldenByPath: {
                old: expectedTypeMismatchWithoutMetaSourceOldPath,
                new: expectedTypeMismatchWithoutMetaSourceNewPath
            }
        },
        {
            name: 'emptyBody',
            type: 'Patient',
            body: undefined,
            headers: noBodyHeaders,
            statusByPath: { old: 500, new: 400 },
            goldenByPath: { old: expectedEmptyBodyOldPath, new: expectedEmptyBodyNewPath }
        },
        {
            name: 'missingOwner',
            type: 'Patient',
            body: patientWithoutOwnerResource,
            status: 400,
            expected: expectedMissingOwner
        },
        {
            name: 'invalidSchema',
            type: 'Patient',
            body: patientInvalidBirthDateResource,
            status: 400,
            expected: expectedInvalidSchema
        },
        {
            name: 'invalidSchemaWithoutOwner',
            type: 'Patient',
            body: patientInvalidBirthDateWithoutOwnerResource,
            status: 400,
            goldenByPath: {
                old: expectedInvalidSchemaWithoutOwnerOldPath,
                new: expectedInvalidSchemaWithoutOwnerNewPath
            }
        },
        {
            name: 'auditEventTooLarge',
            type: 'AuditEvent',
            env: { AUDIT_EVENT_MAX_SIZE_BYTES: '200' },
            body: auditEventResource,
            status: 413,
            expected: expectedAuditEventTooLarge
        },
        {
            name: 'auditEventTooLargeWithoutMetaSource',
            type: 'AuditEvent',
            env: { AUDIT_EVENT_MAX_SIZE_BYTES: '200' },
            body: auditEventWithoutMetaSourceResource,
            statusByPath: { old: 400, new: 413 },
            goldenByPath: {
                old: expectedAuditEventTooLargeWithoutMetaSourceOldPath,
                new: expectedAuditEventTooLargeWithoutMetaSourceNewPath
            }
        },
        {
            name: 'auditEventTooLargeInvalidSchema',
            type: 'AuditEvent',
            env: { AUDIT_EVENT_MAX_SIZE_BYTES: '200' },
            body: auditEventInvalidRecordedResource,
            statusByPath: { old: 400, new: 413 },
            goldenByPath: {
                old: expectedAuditEventTooLargeInvalidSchemaOldPath,
                new: expectedAuditEventTooLargeInvalidSchemaNewPath
            }
        },
        {
            name: 'auditEventTooLargeAccessTagNotGrantable',
            type: 'AuditEvent',
            env: { AUDIT_EVENT_MAX_SIZE_BYTES: '200' },
            body: auditEventTwoAccessTagsResource,
            headers: getHeaders('user/*.* access/client.*'),
            status: 413,
            expected: expectedAuditEventTooLarge
        },
        {
            name: 'groupOverLimitWithInvalidField',
            type: 'Group',
            env: { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '3' },
            body: groupOverLimitWithInvalidFieldResource,
            status: 400,
            goldenByPath: {
                old: expectedGroupOverLimitWithInvalidFieldOldPath,
                new: expectedGroupOverLimitWithInvalidFieldNewPath
            }
        },
        {
            name: 'auditEventCreated',
            type: 'AuditEvent',
            body: auditEventResource,
            status: 201,
            expected: expectedAuditEventCreated,
            assertStoredDocuments: ({ documents, id }) => {
                expect(documents.map((document) => document.id)).toStrictEqual([id]);
            }
        },
        {
            name: 'noScope',
            type: 'Patient',
            body: patientResource,
            headers: getHeaders('user/Observation.*'),
            status: 403,
            expected: expectedNoScope
        },
        {
            name: 'otherTenant',
            type: 'Patient',
            body: patientOtherTenantResource,
            headers: getHeaders('user/*.* access/client.*'),
            status: 403,
            expected: expectedOtherTenant
        },
        {
            name: 'accessTagNotGrantable',
            type: 'Patient',
            body: patientTwoAccessTagsResource,
            headers: getHeaders('user/*.* access/client.*'),
            status: 403,
            expected: expectedAccessTagNotGrantable
        },
        {
            name: 'personLinkOtherTenant',
            type: 'Person',
            previous: [patientOtherTenantResource],
            body: personLinkOtherTenantResource,
            headers: getHeaders('user/*.* access/client.*'),
            status: 400,
            expected: expectedPersonLinkOtherTenant
        },
        {
            name: 'personLinkOtherTenantTagNotGrantable',
            type: 'Person',
            previous: [patientOtherTenantResource],
            body: personLinkOtherTenantTwoAccessTagsResource,
            headers: getHeaders('user/*.* access/client.*'),
            statusByPath: { old: 400, new: 403 },
            goldenByPath: {
                old: expectedPersonLinkOtherTenantTagNotGrantableOldPath,
                new: expectedPersonLinkOtherTenantTagNotGrantableNewPath
            }
        },
        {
            name: 'patientScopeOwn',
            type: 'Observation',
            previous: [personResource],
            body: observationResource,
            headers: patientScopeHeaders,
            status: 201,
            expected: expectedPatientScopeOwn
        },
        {
            name: 'patientScopeOther',
            type: 'Observation',
            previous: [personResource],
            body: observationOtherPatientResource,
            headers: patientScopeHeaders,
            status: 403,
            expected: expectedPatientScopeOther
        },
        {
            name: 'attachmentStored',
            type: 'DocumentReference',
            body: documentReferenceAttachmentResource,
            status: 201,
            expected: expectedAttachmentStored,
            stored: expectedStoredAttachmentStored,
            assertStoredDocuments: ({ documents, gridFsFileIds }) => {
                expect(documents).toHaveLength(1);
                expect(gridFsFileIds).toHaveLength(1);
                expect(documents[0].content).toStrictEqual([
                    { attachment: { contentType: 'text/plain', _file_id: gridFsFileIds[0] } }
                ]);
            }
        }
    ];

    test.each(withEachPath(cases))('$name on the $path path', async ({
        path,
        type,
        env = {},
        previous = [],
        body,
        headers = getHeaders(),
        status: caseStatus,
        statusByPath,
        expected,
        goldenByPath,
        stored,
        assertStoredDocuments
    }) => {
        const request = await createTestRequest();
        useWritePath('old');
        for (const resource of previous) {
            await storeResource(request, resource).expect(200);
        }
        Object.assign(process.env, env);
        useWritePath(path);

        const resp = await createResource(request, type, body, headers);

        const status = statusFor({ status: caseStatus, statusByPath, path });
        expect(resp.status).toBe(status);
        const golden = goldenFor({ expected, goldenByPath, path });
        if (status !== 201) {
            resp.body = withGoldenIdsMasked(resp.body);
            expect(resp).toHaveResponse(golden);
            for (const resourceType of typesThatMustNotBeStored(type, body)) {
                expect(await readStoredDocuments(resourceType)).toStrictEqual([]);
            }
            return;
        }
        const id = resp.headers.location.split('/').pop();
        const returnsMinimal = headers.Prefer === 'return=minimal';
        const bodyId = returnsMinimal ? id : resp.body.id;
        expect(isUuid(bodyId)).toBe(true);
        expect(bodyId).toBe(id);
        expect(resp.headers.etag).toBe('W/"1"');
        expect(resp.headers.location).toBe(`4_0_0/${type}/${id}`);
        expect(resp.headers['content-location']).toMatch(`/4_0_0/${type}/${id}/_history/1`);
        if (!returnsMinimal) {
            expect(resp.body.meta.lastUpdated).toMatch(INSTANT_PATTERN);
        }
        resp.body = withGoldenId(resp.body, id);
        expect(resp).toHaveResponse(golden);
        if (stored) {
            const storedResp = await request.get(`/4_0_0/${type}/${id}`).set(getHeaders());
            expect(storedResp.status).toBe(200);
            storedResp.body = withGoldenId(storedResp.body, id);
            expect(storedResp).toHaveResponse(stored);
        }
        if (assertStoredDocuments) {
            assertStoredDocuments({
                documents: await readStoredDocuments(type),
                gridFsFileIds: await readGridFsFileIds(),
                id
            });
        }
    });

    test('routes POST to the write pipeline when the switch is on', async () => {
        const request = await createTestRequest();
        const runSpy = jest.spyOn(WritePipeline.prototype, 'runAsync');
        try {
            useWritePath('new');

            await createResource(request, 'Patient', patientResource).expect(201);

            expect(runSpy).toHaveBeenCalledTimes(1);
            expect(runSpy.mock.calls[0][0].profile.name).toBe('create');
        } finally {
            runSpy.mockRestore();
        }
    });

    test('keeps POST on the old path when the switch is off', async () => {
        const request = await createTestRequest();
        const runSpy = jest.spyOn(WritePipeline.prototype, 'runAsync');
        try {
            useWritePath('old');

            await createResource(request, 'Patient', patientResource).expect(201);

            expect(runSpy).not.toHaveBeenCalled();
        } finally {
            runSpy.mockRestore();
        }
    });
});
