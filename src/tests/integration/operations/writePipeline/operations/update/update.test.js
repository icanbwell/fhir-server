const fs = require('fs');
const path = require('path');
const deepcopy = require('deepcopy');

const patientResource = require('./fixtures/patient.json');
const patientByUuidResource = require('./fixtures/patientByUuid.json');
const patientOtherTenantResource = require('./fixtures/patientOtherTenant.json');
const observationResource = require('./fixtures/observation.json');
const personResource = require('./fixtures/person.json');
const personWithoutLinksResource = require('./fixtures/personWithoutLinks.json');
const groupResource = require('./fixtures/group.json');
const compositionResource = require('./fixtures/composition.json');
const documentReferenceResource = require('./fixtures/documentReference.json');
const binaryResource = require('./fixtures/binary.json');
const auditEventResource = require('./fixtures/auditEvent.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { MockS3Client } = require('../../../../export/mocks/s3Client');
const { CLOUD_STORAGE_CLIENTS } = require('../../../../../../constants');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../../../utils/mongoGroupExtendedTag');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');
const {
    describe,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
    test,
    expect
} = require('@jest/globals');

/**
 * The two write paths each case runs on.
 */
const PATHS = ['old', 'new'];

/**
 * The folder the golden responses and stored states are read from and recorded to.
 */
const EXPECTED_DIR = path.join(__dirname, 'fixtures', 'expected');

/**
 * When set to `1`, each run writes its response and stored state to its golden files instead of
 * comparing them. A per-path case is recorded only for the path whose golden name is set.
 */
const RECORDING = process.env.RECORD_PUT_PARITY_GOLDENS === '1';

/**
 * The environment variables a case or a path switch may change, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_EXTENDED_GROUP',
    'GROUP_MEMBER_PROMOTION_LIMIT'
];

/**
 * The environment variables that externalize Binary.data to a mocked cloud storage bucket for the
 * whole file, because the base64 manager reads them once, when the container is built.
 */
const BASE64_ENVIRONMENT = {
    BASE64_FIELD_CLOUD_STORAGE_ENABLED: '1',
    BASE64_FIELD_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    RESOURCE_BUCKET_NAME: 'test-put-parity-live-bucket',
    HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    HISTORY_RESOURCE_BUCKET_NAME: 'test-put-parity-history-bucket',
    BASE64_FIELD_DATA_THRESHOLD_KB: '0'
};

/**
 * The shape of a full instant, which is what the server stamps on `meta.lastUpdated`.
 */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * How long to keep polling the history collection for the rows a write queues after its response.
 */
const HISTORY_POLL_ATTEMPTS = 20;

/**
 * Registers mocked cloud storage clients for the base64 live and history buckets.
 */
const registerMockClients = (container) => {
    container.register(
        'base64FieldCloudStorageClient',
        (c) =>
            new MockS3Client({
                bucketName: c.configManager.resourceBucketName,
                region: c.configManager.awsRegion
            })
    );
    container.register(
        'historyResourceCloudStorageClient',
        (c) =>
            new MockS3Client({
                bucketName: c.configManager.historyResourceBucketName,
                region: c.configManager.awsRegion
            })
    );
    return container;
};

/**
 * Returns a copy of the resource with the given top-level fields replaced.
 */
const variant = (resource, changes) => ({ ...deepcopy(resource), ...changes });

/**
 * Returns a copy of the resource with its `meta.security` replaced by the given tags.
 */
const withSecurity = (resource, security) =>
    variant(resource, { meta: { ...deepcopy(resource.meta), security } });

/**
 * Returns an access tag for the given client code.
 */
const accessTag = (code) => ({ system: 'https://www.icanbwell.com/access', code });

/**
 * Returns an owner tag for the given client code.
 */
const ownerTag = (code) => ({ system: 'https://www.icanbwell.com/owner', code });

/**
 * Returns the given number of Group members pointing at synthetic patients.
 */
const groupMembers = (count) =>
    Array.from({ length: count }, (_, index) => ({
        entity: { reference: `Patient/put-parity-member-${index}` }
    }));

/**
 * Sends PUT to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (writePath) => {
    process.env.WRITE_PIPELINE_OPERATIONS = writePath === 'new' ? 'update' : '';
};

/**
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

/**
 * Sends the PUT of a case. A case without a body sends no body at all.
 */
const putResource = (request, { type, id, body, headers }) => {
    const put = request.put(`/4_0_0/${type}/${id}`).set(headers);
    return body === undefined ? put : put.send(body);
};

/**
 * Waits until every post-request task the server has queued has finished.
 */
const waitForPostRequestTasks = () =>
    getTestContainer().postRequestProcessor.waitTillAllRequestsDoneAsync({ timeoutInSeconds: 20 });

/**
 * Waits for the given number of milliseconds.
 */
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Returns the expectation a case has on the given path: `{ status, golden }`, taken from the
 * case itself when it has one golden, or from its `old` or `newPath` entry when it has one per path.
 */
const expectationFor = (testCase, writePath) => {
    if (testCase.old) {
        return writePath === 'old' ? testCase.old : testCase.newPath;
    }
    return { status: testCase.status, golden: testCase.golden };
};

/**
 * Expands each case into one run per path, split into the runs that have a golden and the
 * per-path runs still waiting for their new-path golden.
 */
const runsOf = (cases) => {
    const runs = cases.flatMap((testCase) =>
        PATHS.map((writePath) => ({
            ...testCase,
            path: writePath,
            expectation: expectationFor(testCase, writePath)
        }))
    );
    return {
        ready: runs.filter((run) => run.expectation.golden),
        pending: runs.filter((run) => !run.expectation.golden)
    };
};

/**
 * Reads a golden file from the expected folder.
 */
const readGolden = (fileName) =>
    JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, `${fileName}.json`), 'utf8'));

/**
 * Writes a golden file to the expected folder.
 */
const writeGolden = (fileName, content) =>
    fs.writeFileSync(
        path.join(EXPECTED_DIR, `${fileName}.json`),
        `${JSON.stringify(content, null, 2)}\n`,
        'utf8'
    );

/**
 * Returns a copy of a response body without `meta.lastUpdated`, which `toHaveResponse` ignores.
 */
const withoutLastUpdated = (body) => {
    const copy = deepcopy(body);
    if (copy && copy.meta) {
        delete copy.meta.lastUpdated;
    }
    return copy;
};

/**
 * Reads every document stored in the resource type's collection straight from MongoDB.
 */
const readStoredDocuments = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getDatabaseForResourceAsync({
        resourceType
    });
    return db.collection(`${resourceType}_4_0_0`).find({}).sort({ _uuid: 1 }).toArray();
};

/**
 * Reads every history row of the resource type straight from MongoDB, oldest version first.
 */
const readHistoryRows = async (resourceType) => {
    const db = await getTestContainer().mongoDatabaseManager.getResourceHistoryDbAsync();
    return db
        .collection(`${resourceType}_4_0_0_History`)
        .find({})
        .sort({ 'resource._uuid': 1, 'resource.meta.versionId': 1 })
        .toArray();
};

/**
 * Reads the history rows of the resource type once the post-request tasks are done, polling
 * until two reads in a row agree and, when the expected number of rows is known, have that many.
 */
const readSettledHistoryRows = async (resourceType, expectedCount) => {
    await waitForPostRequestTasks();
    let rows = await readHistoryRows(resourceType);
    for (let attempt = 0; attempt < HISTORY_POLL_ATTEMPTS; attempt++) {
        await delay(250);
        const next = await readHistoryRows(resourceType);
        const settled = next.length === rows.length;
        rows = next;
        if (settled && (expectedCount === undefined || rows.length === expectedCount)) {
            break;
        }
    }
    return rows;
};

/**
 * Reads the id of every file stored in GridFS, in upload order.
 */
const readGridFsFileIds = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    const files = await db.collection('fs.files').find({}).sort({ uploadDate: 1, _id: 1 }).toArray();
    return files.map((file) => file._id.toString());
};

/**
 * Returns the cloud storage key of a stored Binary's live base64 object, or null when it has none.
 */
const liveKeyOf = (document) =>
    document?._blobMeta?.lastUpdated
        ? `Binary_4_0_0/${document._uuid}/${new Date(document._blobMeta.lastUpdated).getTime()}`
        : null;

/**
 * Returns a JSON copy of stored documents or history rows with the values that change on every
 * run masked: MongoDB ids, server-set `lastUpdated` instants, recorded timestamps, request ids,
 * and GridFS file ids (named by upload order). A `lastUpdated` that is not an instant is kept.
 */
const normalizeStored = (value, gridFsFileIds) => {
    const masked = JSON.parse(
        JSON.stringify(value, function (key, entry) {
            if (key === '_id') {
                return undefined;
            }
            if (key === 'lastUpdated' && INSTANT_PATTERN.test(entry)) {
                return '<lastUpdated>';
            }
            if (key === '_recorded' && entry) {
                return '<recorded>';
            }
            return entry;
        })
    );
    for (const row of [].concat(masked)) {
        if (row && row.request && row.request.id) {
            row.request.id = '<requestId>';
        }
    }
    let text = JSON.stringify(masked);
    gridFsFileIds.forEach((fileId, index) => {
        text = text.replaceAll(fileId, `<gridFsFile:${index}>`);
    });
    return JSON.parse(text);
};

/**
 * The headers of a patient-scoped caller whose own Person is the stored `person.json`, with the
 * same `Host` as `getHeaders()` so `Content-Location` doesn't carry the test server's port.
 */
const patientScopeHeaders = {
    ...getHeadersWithCustomPayload({
        scope: 'patient/Observation.*',
        username: 'parity-patient-user',
        clientFhirPersonId: generateUUIDv5('parity-person-1|client'),
        clientFhirPatientId: 'clientFhirPatient',
        bwellFhirPersonId: generateUUIDv5('parity-person-1|client'),
        bwellFhirPatientId: 'bwellFhirPatient',
        token_use: 'access'
    }),
    Host: 'localhost:3000'
};

/**
 * The headers of a caller with write access to the `client` tenant only.
 */
const clientOnlyHeaders = getHeaders('user/*.* access/client.*');

/**
 * The headers of a caller with write access to the `other-client` tenant only.
 */
const otherClientOnlyHeaders = getHeaders('user/*.* access/other-client.*');

/**
 * Returns full-access headers with the given extra request headers.
 */
const headersWith = (extra) => ({ ...getHeaders(), ...extra });

/**
 * The headers of a full-scope PUT that sends no body. The server does not parse an
 * `application/fhir+ndjson` body, so the operation gets no body, as for a request without
 * `Content-Length`.
 */
const noBodyHeaders = { ...getHeaders(), 'Content-Type': 'application/fhir+ndjson' };

/**
 * Sets `_extended` on the stored Group, the way the extended Group tests mark one.
 */
const markGroupExtended = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    await db
        .collection('Group_4_0_0')
        .updateOne({ id: groupResource.id }, { $set: { [MONGO_GROUP_EXTENDED_FIELD]: true } });
};

/**
 * Removes `meta.versionId` from the stored Patient.
 */
const removeStoredPatientVersion = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    await db
        .collection('Patient_4_0_0')
        .updateOne({ id: patientResource.id }, { $unset: { 'meta.versionId': '' } });
};

const patientRenamed = variant(patientResource, {
    name: [{ family: 'Parity', given: ['Gamma'] }]
});
const patientTwoAccessTags = withSecurity(patientResource, [
    accessTag('client'),
    accessTag('other-client'),
    ownerTag('client')
]);
const groupOverLimitEnvironment = { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '3' };

describe('PUT parity between the old and the new write path', () => {
    const originalEnvironment = Object.fromEntries(
        [...ENVIRONMENT_KEYS, ...Object.keys(BASE64_ENVIRONMENT)].map((key) => [
            key,
            process.env[key]
        ])
    );

    /**
     * Puts every environment variable this file changes back to its value before the file ran.
     */
    const restoreEnvironment = (keys) => {
        for (const key of keys) {
            if (originalEnvironment[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnvironment[key];
            }
        }
    };

    beforeAll(() => {
        Object.assign(process.env, BASE64_ENVIRONMENT);
    });

    afterAll(() => {
        restoreEnvironment(Object.keys(BASE64_ENVIRONMENT));
    });

    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        restoreEnvironment(ENVIRONMENT_KEYS);
        await commonAfterEach();
    });

    const cases = [
        {
            name: 'createViaPut',
            type: 'Patient',
            id: patientResource.id,
            body: patientResource,
            status: 201,
            golden: 'createViaPut'
        },
        {
            name: 'updateExisting',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            status: 200,
            golden: 'updateExisting'
        },
        {
            name: 'updateByIdWithAuthority',
            type: 'Patient',
            id: `${patientResource.id}|client`,
            previous: [patientResource],
            body: patientRenamed,
            status: 200,
            golden: 'updateByIdWithAuthority'
        },
        {
            name: 'noOp',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientResource,
            status: 200,
            golden: 'noOp',
            keepsStoredLastUpdated: true
        },
        {
            name: 'bodyIdDiffersFromUrl',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientRenamed, { id: 'put-parity-other-id' }),
            status: 200,
            golden: 'bodyIdDiffersFromUrl'
        },
        {
            name: 'clientUnderscoreFieldsStripped',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientRenamed, {
                _uuid: '22222222-2222-4222-8222-222222222222',
                _sourceAssigningAuthority: 'other-client',
                _access: { 'other-client': 1 },
                photo: [{ contentType: 'text/plain', _file_id: '000000000000000000000001' }]
            }),
            status: 200,
            golden: 'clientUnderscoreFieldsStripped'
        },
        {
            name: 'lastUpdatedNotAnInstant',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientRenamed, {
                meta: { ...deepcopy(patientResource.meta), lastUpdated: '2026-01-01' }
            }),
            status: 200,
            golden: 'lastUpdatedNotAnInstant'
        },
        {
            name: 'dateOnlyChangeSaved',
            type: 'Composition',
            id: compositionResource.id,
            previous: [compositionResource],
            body: variant(compositionResource, { date: '2026-02-02T00:00:00.000Z' }),
            status: 200,
            golden: 'dateOnlyChangeSaved'
        },
        {
            name: 'identifierReplaceKeepsSourceIdAndUuid',
            type: 'Patient',
            id: patientResource.id,
            previous: [
                variant(patientResource, {
                    identifier: [{ system: 'http://example.com/parity-id', value: 'first' }]
                })
            ],
            body: variant(patientResource, {
                identifier: [{ system: 'http://example.com/parity-id', value: 'second' }]
            }),
            status: 200,
            golden: 'identifierReplaceKeepsSourceIdAndUuid'
        },
        {
            name: 'idAuthorityMismatch',
            type: 'Patient',
            id: `${patientResource.id}|other-client`,
            previous: [patientResource],
            body: patientRenamed,
            status: 400,
            golden: 'idAuthorityMismatch'
        },
        {
            name: 'nonUuidIdWithoutAuthorityTag',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: withSecurity(patientRenamed, [accessTag('client')]),
            status: 400,
            golden: 'nonUuidIdWithoutAuthorityTag'
        },
        {
            name: 'ownerTagWithoutCode',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: withSecurity(patientRenamed, [
                accessTag('client'),
                { system: 'https://www.icanbwell.com/owner' }
            ]),
            status: 500,
            golden: 'ownerTagWithoutCode'
        },
        {
            name: 'scopeMissing',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            headers: getHeaders('user/Observation.*'),
            status: 403,
            golden: 'scopeMissing'
        },
        {
            name: 'storedNotAccessible',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            headers: otherClientOnlyHeaders,
            status: 403,
            golden: 'storedNotAccessible'
        },
        {
            name: 'storedNotAccessiblePatientReferenceChanged',
            type: 'Observation',
            id: observationResource.id,
            previous: [observationResource],
            body: variant(observationResource, {
                subject: { reference: 'Patient/parity-patient-2' }
            }),
            headers: otherClientOnlyHeaders,
            status: 403,
            golden: 'storedNotAccessiblePatientReferenceChanged',
            notInBody: ['parity-patient-1']
        },
        {
            name: 'patientScopeOwn',
            type: 'Observation',
            id: observationResource.id,
            previous: [personResource, observationResource],
            body: variant(observationResource, { status: 'amended' }),
            headers: patientScopeHeaders,
            status: 200,
            golden: 'patientScopeOwn'
        },
        {
            name: 'patientScopeOther',
            type: 'Observation',
            id: observationResource.id,
            previous: [
                personResource,
                variant(observationResource, {
                    subject: { reference: 'Patient/parity-patient-2' }
                })
            ],
            body: variant(observationResource, {
                status: 'amended',
                subject: { reference: 'Patient/parity-patient-2' }
            }),
            headers: patientScopeHeaders,
            status: 403,
            golden: 'patientScopeOther'
        },
        {
            name: 'accessTagAddNotGrantable',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientTwoAccessTags,
            headers: clientOnlyHeaders,
            status: 403,
            golden: 'accessTagAddNotGrantable'
        },
        {
            name: 'accessTagRemoveNotGrantable',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientTwoAccessTags],
            body: patientRenamed,
            headers: clientOnlyHeaders,
            status: 403,
            golden: 'accessTagRemoveNotGrantable'
        },
        {
            name: 'accessTagAddGranted',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientTwoAccessTags,
            headers: getHeaders('user/*.* access/client.* access/other-client.*'),
            status: 200,
            golden: 'accessTagAddGranted'
        },
        {
            name: 'noMetaSecurityScopedCaller',
            type: 'Patient',
            id: patientByUuidResource.id,
            previous: [
                withSecurity(patientByUuidResource, [
                    accessTag('client'),
                    accessTag('put-parity-unscoped'),
                    ownerTag('client')
                ])
            ],
            body: variant(patientByUuidResource, {
                meta: { source: patientByUuidResource.meta.source },
                name: [{ family: 'Parity', given: ['Gamma'] }]
            }),
            headers: clientOnlyHeaders,
            old: { status: 500, golden: 'noMetaSecurityScopedCallerOldPath' },
            newPath: { status: 403, golden: 'noMetaSecurityScopedCallerNewPath' }
        },
        {
            name: 'noMetaSecurityFullAccess',
            type: 'Patient',
            id: patientByUuidResource.id,
            previous: [patientByUuidResource],
            body: variant(patientByUuidResource, {
                meta: { source: patientByUuidResource.meta.source },
                name: [{ family: 'Parity', given: ['Gamma'] }]
            }),
            old: { status: 500, golden: 'noMetaSecurityFullAccessOldPath' },
            newPath: { status: 200, golden: 'noMetaSecurityFullAccessNewPath' }
        },
        {
            name: 'createViaPutAccessDenied',
            type: 'Patient',
            id: patientOtherTenantResource.id,
            body: patientOtherTenantResource,
            headers: clientOnlyHeaders,
            status: 403,
            golden: 'createViaPutAccessDenied'
        },
        {
            name: 'invalidSchema',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientResource, { birthDate: 'not-a-date' }),
            status: 400,
            golden: 'invalidSchema'
        },
        {
            name: 'patientReferenceChanged',
            type: 'Observation',
            id: observationResource.id,
            previous: [observationResource],
            body: variant(observationResource, {
                subject: { reference: 'Patient/parity-patient-2' }
            }),
            status: 400,
            golden: 'patientReferenceChanged'
        },
        {
            name: 'personLinkOtherTenant',
            type: 'Person',
            id: personWithoutLinksResource.id,
            previous: [patientOtherTenantResource, personWithoutLinksResource],
            body: variant(personWithoutLinksResource, {
                link: [{ target: { reference: `Patient/${patientOtherTenantResource.id}` } }]
            }),
            headers: clientOnlyHeaders,
            status: 400,
            golden: 'personLinkOtherTenant'
        },
        {
            name: 'metaMissingOwnerOnCreate',
            type: 'Patient',
            id: patientByUuidResource.id,
            body: withSecurity(patientByUuidResource, [accessTag('client')]),
            status: 400,
            golden: 'metaMissingOwnerOnCreate'
        },
        {
            name: 'metaMultipleOwnersOnUpdate',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: withSecurity(patientRenamed, [
                accessTag('client'),
                ownerTag('client'),
                ownerTag('other-client')
            ]),
            status: 200,
            golden: 'metaMultipleOwnersOnUpdate'
        },
        {
            name: 'extendedGroupWithMembers',
            type: 'Group',
            id: groupResource.id,
            previous: [groupResource],
            afterStore: markGroupExtended,
            body: variant(groupResource, { member: groupMembers(1) }),
            status: 400,
            golden: 'extendedGroupWithMembers'
        },
        {
            name: 'groupOverLimit',
            type: 'Group',
            id: groupResource.id,
            previous: [groupResource],
            env: groupOverLimitEnvironment,
            body: variant(groupResource, { member: groupMembers(4) }),
            status: 400,
            golden: 'groupOverLimit'
        },
        {
            name: 'ifMatchMatches',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            headers: headersWith({ 'If-Match': 'W/"1"' }),
            status: 200,
            golden: 'ifMatchMatches'
        },
        {
            name: 'ifMatchWeakLowercaseList',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            headers: headersWith({ 'If-Match': 'w/"5", W/"1"' }),
            status: 200,
            golden: 'ifMatchWeakLowercaseList'
        },
        {
            name: 'ifMatchStar',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            headers: headersWith({ 'If-Match': '*' }),
            status: 200,
            golden: 'ifMatchStar'
        },
        {
            name: 'ifMatchMismatch',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            headers: headersWith({ 'If-Match': 'W/"7"' }),
            status: 412,
            golden: 'ifMatchMismatch'
        },
        {
            name: 'ifMatchNoStored',
            type: 'Patient',
            id: patientResource.id,
            body: patientRenamed,
            headers: headersWith({ 'If-Match': 'W/"1"' }),
            status: 412,
            golden: 'ifMatchNoStored'
        },
        {
            name: 'ifMatchStoredWithoutVersion',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            afterStore: removeStoredPatientVersion,
            body: patientRenamed,
            headers: headersWith({ 'If-Match': 'W/"1"' }),
            status: 412,
            golden: 'ifMatchStoredWithoutVersion'
        },
        {
            name: 'ifNoneMatchStarExisting',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: patientRenamed,
            headers: headersWith({ 'If-None-Match': '*' }),
            status: 412,
            golden: 'ifNoneMatchStarExisting'
        },
        {
            name: 'ifNoneMatchStarNew',
            type: 'Patient',
            id: patientResource.id,
            body: patientResource,
            headers: headersWith({ 'If-None-Match': '*' }),
            status: 201,
            golden: 'ifNoneMatchStarNew'
        },
        {
            name: 'gridfsRoundTrip',
            type: 'DocumentReference',
            id: documentReferenceResource.id,
            previous: [documentReferenceResource],
            body: variant(documentReferenceResource, { description: 'second' }),
            status: 200,
            golden: 'gridfsRoundTrip'
        },
        {
            name: 'base64DataChanged',
            type: 'Binary',
            id: binaryResource.id,
            previous: [binaryResource],
            body: variant(binaryResource, { data: 'Qg==' }),
            status: 200,
            golden: 'base64DataChanged'
        },
        {
            name: 'auditEventPut405',
            type: 'AuditEvent',
            id: auditEventResource.id,
            body: auditEventResource,
            status: 405,
            golden: 'auditEventPut405'
        },
        {
            name: 'emptyBody',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: undefined,
            headers: noBodyHeaders,
            old: { status: 500, golden: 'emptyBodyOldPath' },
            newPath: { status: 400, golden: 'emptyBodyNewPath' }
        },
        {
            name: 'arrayBody',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [patientRenamed, patientRenamed],
            old: { status: 400, golden: 'arrayBodyOldPath' },
            newPath: { status: 400, golden: 'arrayBodyNewPath' }
        },
        {
            name: 'typeMismatchWithoutScope',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(observationResource, { id: patientResource.id }),
            headers: getHeaders('user/Observation.*'),
            old: { status: 403, golden: 'typeMismatchWithoutScopeOldPath' },
            newPath: { status: 400, golden: 'typeMismatchWithoutScopeNewPath' }
        },
        {
            name: 'invalidSchemaStoredNotAccessible',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: variant(patientResource, { birthDate: 'not-a-date' }),
            headers: otherClientOnlyHeaders,
            old: { status: 403, golden: 'invalidSchemaStoredNotAccessibleOldPath' },
            newPath: { status: 400, golden: 'invalidSchemaStoredNotAccessibleNewPath' }
        },
        {
            name: 'ifMatchMismatchPatientReferenceChanged',
            type: 'Observation',
            id: observationResource.id,
            previous: [observationResource],
            body: variant(observationResource, {
                subject: { reference: 'Patient/parity-patient-2' }
            }),
            headers: headersWith({ 'If-Match': 'W/"7"' }),
            old: { status: 400, golden: 'ifMatchMismatchPatientReferenceChangedOldPath' },
            newPath: { status: 412, golden: 'ifMatchMismatchPatientReferenceChangedNewPath' }
        },
        {
            name: 'accessTagRemoveNotGrantableInvalidReference',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientTwoAccessTags],
            body: variant(patientRenamed, {
                managingOrganization: { reference: 'not-a-reference' }
            }),
            headers: clientOnlyHeaders,
            old: { status: 400, golden: 'accessTagRemoveNotGrantableInvalidReferenceOldPath' },
            newPath: { status: 403, golden: 'accessTagRemoveNotGrantableInvalidReferenceNewPath' }
        },
        {
            name: 'groupOverLimitWithInvalidField',
            type: 'Group',
            id: groupResource.id,
            previous: [groupResource],
            env: groupOverLimitEnvironment,
            body: variant(groupResource, { member: groupMembers(4), notAFhirField: 'x' }),
            old: { status: 400, golden: 'groupOverLimitWithInvalidFieldOldPath' },
            newPath: { status: 400, golden: 'groupOverLimitWithInvalidFieldNewPath' }
        },
        {
            name: 'createViaPutPersonLinkOtherTenantAccessDenied',
            type: 'Person',
            id: personWithoutLinksResource.id,
            previous: [patientOtherTenantResource],
            body: withSecurity(
                variant(personWithoutLinksResource, {
                    link: [{ target: { reference: `Patient/${patientOtherTenantResource.id}` } }]
                }),
                [accessTag('client'), accessTag('other-client'), ownerTag('client')]
            ),
            headers: clientOnlyHeaders,
            old: { status: 400, golden: 'createViaPutPersonLinkOtherTenantAccessDeniedOldPath' },
            newPath: { status: 403, golden: 'createViaPutPersonLinkOtherTenantAccessDeniedNewPath' }
        },
        {
            name: 'noOpGroupOverLoweredLimit',
            type: 'Group',
            id: groupResource.id,
            storeEnv: { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '10' },
            previous: [variant(groupResource, { member: groupMembers(4) })],
            env: groupOverLimitEnvironment,
            body: variant(groupResource, { member: groupMembers(4) }),
            old: { status: 400, golden: 'noOpGroupOverLoweredLimitOldPath' },
            newPath: { status: 200, golden: 'noOpGroupOverLoweredLimitNewPath' }
        },
        {
            name: 'base64UnrelatedFieldChanged',
            type: 'Binary',
            id: binaryResource.id,
            previous: [binaryResource],
            body: variant(binaryResource, { contentType: 'application/xml' }),
            old: { status: 200, golden: 'base64UnrelatedFieldChangedOldPath' },
            newPath: { status: 200, golden: 'base64UnrelatedFieldChangedNewPath' }
        }
    ];

    const { ready, pending } = runsOf(cases);

    test.each(ready)('$name on the $path path', async ({
        path: writePath,
        type,
        id,
        storeEnv = {},
        previous = [],
        afterStore,
        env = {},
        body,
        headers = getHeaders(),
        expectation,
        notInBody = [],
        keepsStoredLastUpdated = false
    }) => {
        const request = await createTestRequest(registerMockClients);
        useWritePath('old');
        Object.assign(process.env, storeEnv);
        for (const resource of previous) {
            const stored = await storeResource(request, resource);
            expect(stored.status).toBe(200);
            expect(stored.body.created).toBe(true);
        }
        await waitForPostRequestTasks();
        if (afterStore) {
            await afterStore();
        }
        const [storedBefore] = await readStoredDocuments(type);
        const liveKeyBefore = liveKeyOf(storedBefore);
        Object.assign(process.env, env);
        useWritePath(writePath);

        const resp = await putResource(request, { type, id, body, headers });

        expect(resp.status).toBe(expectation.status);
        for (const text of notInBody) {
            expect(JSON.stringify(resp.body)).not.toContain(text);
        }
        if ([200, 201].includes(resp.status) && headers.Prefer !== 'return=minimal') {
            expect(resp.body.meta.lastUpdated).toMatch(INSTANT_PATTERN);
        }
        const goldenState = RECORDING ? undefined : readGolden(`${expectation.golden}State`);
        const documents = await readStoredDocuments(type);
        const history = await readSettledHistoryRows(type, goldenState?.history.length);
        const gridFsFileIds = await readGridFsFileIds();
        const liveKeyAfter = liveKeyOf(documents[0]);
        if (keepsStoredLastUpdated) {
            expect(documents[0].meta.lastUpdated).toStrictEqual(storedBefore.meta.lastUpdated);
        }
        const state = {
            headers: {
                ...(resp.status >= 200 && resp.status < 300 ? { etag: resp.headers.etag ?? null } : {}),
                location: resp.headers.location ?? null,
                contentLocation: resp.headers['content-location'] ?? null
            },
            documents: normalizeStored(documents, gridFsFileIds),
            history: normalizeStored(history, gridFsFileIds),
            gridFsFileCount: gridFsFileIds.length,
            ...(type === 'Binary'
                ? {
                      liveKeyChanged: liveKeyBefore !== liveKeyAfter,
                      liveData:
                          getTestContainer().base64FieldCloudStorageClient.uploadedData[liveKeyAfter] ??
                          null
                  }
                : {})
        };

        if (RECORDING) {
            writeGolden(expectation.golden, withoutLastUpdated(resp.body));
            writeGolden(`${expectation.golden}State`, state);
            return;
        }
        expect(resp).toHaveResponse(readGolden(expectation.golden));
        expect(state).toStrictEqual(goldenState);
    });

    if (pending.length > 0) {
        test.skip.each(pending)('$name on the $path path (new-path golden not recorded yet)', () => {});
    }
});
