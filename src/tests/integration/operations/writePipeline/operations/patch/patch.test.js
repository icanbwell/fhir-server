const fs = require('fs');
const path = require('path');
const deepcopy = require('deepcopy');

const patientResource = require('../update/fixtures/patient.json');
const patientOtherTenantResource = require('../update/fixtures/patientOtherTenant.json');
const observationResource = require('../update/fixtures/observation.json');
const personResource = require('../update/fixtures/person.json');
const personWithoutLinksResource = require('../update/fixtures/personWithoutLinks.json');
const groupResource = require('../update/fixtures/group.json');
const compositionResource = require('../update/fixtures/composition.json');
const documentReferenceResource = require('../update/fixtures/documentReference.json');
const binaryResource = require('../update/fixtures/binary.json');
const auditEventResource = require('../update/fixtures/auditEvent.json');
const organizationResource = require('./fixtures/organization.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getHeadersWithCustomPayload,
    createTestRequest,
    getTestContainer
} = require('../../../../common');
const { MockS3Client } = require('../../../../export/mocks/s3Client');
const {
    CLOUD_STORAGE_CLIENTS,
    GROUP_MEMBER_COLLECTION_NAME
} = require('../../../../../../constants');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');
const {
    describe,
    beforeAll,
    afterAll,
    beforeEach,
    afterEach,
    test,
    expect,
    jest
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
const RECORDING = process.env.RECORD_PATCH_PARITY_GOLDENS === '1';

/**
 * The environment variables a case or a path switch may change, restored after every test.
 */
const ENVIRONMENT_KEYS = [
    'WRITE_PIPELINE_OPERATIONS',
    'ENABLE_EXTENDED_GROUP',
    'GROUP_MEMBER_PROMOTION_LIMIT',
    'GROUP_MEMBER_MAX_ENTRIES_PER_MEMBER'
];

/**
 * The environment variables that externalize Binary.data to a mocked cloud storage bucket for the
 * whole file, because the base64 manager reads them once, when the container is built.
 */
const BASE64_ENVIRONMENT = {
    BASE64_FIELD_CLOUD_STORAGE_ENABLED: '1',
    BASE64_FIELD_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    RESOURCE_BUCKET_NAME: 'test-patch-parity-live-bucket',
    HISTORY_RESOURCE_CLOUD_STORAGE_CLIENT: CLOUD_STORAGE_CLIENTS.S3_CLIENT,
    HISTORY_RESOURCE_BUCKET_NAME: 'test-patch-parity-history-bucket',
    BASE64_FIELD_DATA_THRESHOLD_KB: '0'
};

/**
 * The content type of a JSON Patch body, the only one PATCH accepts.
 */
const JSON_PATCH_CONTENT_TYPE = 'application/json-patch+json';

/**
 * The shape of a full instant, which is what the server stamps on `meta.lastUpdated`.
 */
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * How long to keep polling the history collection for the rows a write queues after its response.
 */
const HISTORY_POLL_ATTEMPTS = 20;

/**
 * The most times the access log spy is checked for the PATCH's call, once the response is in.
 */
const MAX_ACCESS_LOG_POLLS = 50;

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
 * Returns a Group member entry pointing at the synthetic patient with the given index.
 */
const groupMember = (index, extra = {}) => ({
    entity: { reference: `Patient/patch-parity-member-${index}` },
    ...extra
});

/**
 * Returns the given number of Group members pointing at synthetic patients.
 */
const groupMembers = (count) => Array.from({ length: count }, (_, index) => groupMember(index));

/**
 * Sends PATCH to the new write pipeline or the old path by setting `WRITE_PIPELINE_OPERATIONS`.
 */
const useWritePath = (writePath) => {
    process.env.WRITE_PIPELINE_OPERATIONS = writePath === 'new' ? 'patch' : '';
};

/**
 * Stores a resource that a case needs to exist already, through `$merge` on the old path.
 */
const storeResource = (request, resource) =>
    request.post(`/4_0_0/${resource.resourceType}/$merge`).send(resource).set(getHeaders());

/**
 * Sends the PATCH of a case.
 */
const patchResource = (request, { type, id, body, headers }) =>
    request.patch(`/4_0_0/${type}/${id}`).send(body).set(headers);

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
 * case itself when it has one golden, or from its `old` or `newPath` entry when it has one per
 * path.
 */
const expectationFor = (testCase, writePath) => {
    if (testCase.old) {
        return writePath === 'old' ? testCase.old : testCase.newPath;
    }
    return { status: testCase.status, golden: testCase.golden };
};

/**
 * Expands each case into one run per path.
 */
const runsOf = (cases) =>
    cases.flatMap((testCase) =>
        PATHS.map((writePath) => ({
            ...testCase,
            path: writePath,
            expectation: expectationFor(testCase, writePath)
        }))
    );

/**
 * Reads a golden file from the expected folder.
 */
const readGolden = (fileName) =>
    JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, `${fileName}.json`), 'utf8'));

/**
 * Writes a golden file to the expected folder.
 */
const writeGolden = (fileName, content) => {
    fs.mkdirSync(EXPECTED_DIR, { recursive: true });
    fs.writeFileSync(
        path.join(EXPECTED_DIR, `${fileName}.json`),
        `${JSON.stringify(content, null, 2)}\n`,
        'utf8'
    );
};

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
 * Replaces every full instant in the error texts of an OperationOutcome response body with a
 * placeholder, because a failed JSON Patch test quotes the stored document, `meta.lastUpdated`
 * included, which differs on every run.
 */
const maskInstantsInOutcome = (body) => {
    if (body?.resourceType !== 'OperationOutcome') {
        return body;
    }
    return JSON.parse(
        JSON.stringify(body).replace(
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g,
            '<instant>'
        )
    );
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
 * Reads every row of the extended Group member collection, in member order.
 */
const readGroupMemberRows = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    return db
        .collection(GROUP_MEMBER_COLLECTION_NAME)
        .find({})
        .sort({ 'member.entity._uuid': 1, _uuid: 1 })
        .toArray();
};

/**
 * Reads every file stored in GridFS, in upload order.
 */
const readGridFsFiles = async () => {
    const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
    return db.collection('fs.files').find({}).sort({ uploadDate: 1, _id: 1 }).toArray();
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
 * Waits until the access logger has been called for the PATCH, which the server does when the
 * response finishes, and returns the arguments of every call.
 */
const waitForAccessLogCalls = async (logAccessLogAsync) => {
    for (let poll = 0; poll < MAX_ACCESS_LOG_POLLS; poll++) {
        if (logAccessLogAsync.mock.calls.length >= 1) {
            break;
        }
        await delay(100);
    }
    return logAccessLogAsync.mock.calls.map(([args]) => args);
};

/**
 * Returns what the access log stores of each call: the status code and the operation result, as
 * JSON.
 */
const summarizeAccessLogCalls = (calls) =>
    calls.map(({ statusCode, operationResult }) => ({
        statusCode,
        operationResult:
            operationResult === undefined ? null : JSON.parse(JSON.stringify(operationResult))
    }));

/**
 * Returns what each AuditEvent request carries: for a write, its operation, resource type, args
 * and ids; for an error, its code and message.
 */
const summarizeAuditCalls = ({ entryCalls, errorCalls }) => ({
    entries: entryCalls.map(([{ resourceType, operation, args, ids }]) =>
        JSON.parse(JSON.stringify({ resourceType, operation, args, ids }))
    ),
    errors: errorCalls.map(([{ errorCode, errorMessage }]) => ({ errorCode, errorMessage }))
});

/**
 * Returns JSON Patch headers for a caller with the given scope, full access by default.
 */
const patchHeaders = (scope) => ({ ...getHeaders(scope), 'Content-Type': JSON_PATCH_CONTENT_TYPE });

/**
 * The JSON Patch headers of a caller with a patient scope and full user and access scopes, whose
 * own Person is the stored `person.json`. The patient scope never allows writing a resource type
 * that is not patient-filterable.
 */
const patientAndUserScopeHeaders = {
    ...getHeadersWithCustomPayload({
        scope: 'patient/*.* user/*.* access/*.*',
        username: 'parity-patient-user',
        clientFhirPersonId: generateUUIDv5('parity-person-1|client'),
        clientFhirPatientId: 'clientFhirPatient',
        bwellFhirPersonId: generateUUIDv5('parity-person-1|client'),
        bwellFhirPatientId: 'bwellFhirPatient',
        token_use: 'access'
    }),
    'Content-Type': JSON_PATCH_CONTENT_TYPE,
    Host: 'localhost:3000'
};

/**
 * The JSON Patch headers of a caller with write access to the `client` tenant only.
 */
const clientOnlyHeaders = patchHeaders('user/*.* access/client.*');

/**
 * The JSON Patch headers of a caller with write access to the `other-client` tenant only.
 */
const otherClientOnlyHeaders = patchHeaders('user/*.* access/other-client.*');

const patientUuid = generateUUIDv5(`${patientResource.id}|client`);
const patientRenamed = variant(patientResource, {
    name: [{ family: 'Parity', given: ['Gamma'] }]
});
const patientTwoNames = variant(patientResource, {
    name: [
        { family: 'Parity', given: ['Alpha'] },
        { family: 'Parity', given: ['Beta'] }
    ]
});
const patientTwoAccessTags = withSecurity(patientResource, [
    accessTag('client'),
    accessTag('other-client'),
    ownerTag('client')
]);
const patientSameIdOtherOwner = withSecurity(patientResource, [
    accessTag('other-client'),
    ownerTag('other-client')
]);
const renameOperation = { op: 'replace', path: '/name/0/given/0', value: 'Gamma' };
const addOtherAccessTagOperation = {
    op: 'add',
    path: '/meta/security/-',
    value: accessTag('other-client')
};
const invalidBirthDateOperation = { op: 'add', path: '/birthDate', value: 'not-a-date' };
const promotionEnvironment = { ENABLE_EXTENDED_GROUP: '1', GROUP_MEMBER_PROMOTION_LIMIT: '3' };

describe('PATCH parity between the old and the new write path', () => {
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
        jest.restoreAllMocks();
        await commonAfterEach();
    });

    const requestCheckCases = [
        {
            name: 'notJsonPatch400',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [renameOperation],
            headers: getHeaders(),
            status: 400,
            golden: 'notJsonPatch400'
        },
        {
            name: 'patchOnInternalField400Path',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [{ op: 'replace', path: '/_uuid', value: 'patch-parity-uuid' }],
            status: 400,
            golden: 'patchOnInternalField400Path'
        },
        {
            name: 'patchOnInternalField400NestedPath',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [{ op: 'add', path: '/managingOrganization/_uuid', value: 'Organization/x' }],
            status: 400,
            golden: 'patchOnInternalField400NestedPath'
        },
        {
            name: 'patchOnInternalField400Value',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [
                {
                    op: 'add',
                    path: '/managingOrganization',
                    value: { reference: 'Organization/patch-parity-org', _uuid: 'Organization/x' }
                }
            ],
            status: 400,
            golden: 'patchOnInternalField400Value'
        },
        {
            name: 'emptyPatch200Unchanged',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [],
            /**
             * Accepted difference: a no-op PATCH answers `updated: false` with the stored document
             * and stores an access-log entry on the new path; neither path writes.
             */
            old: { status: 200, golden: 'emptyPatch200UnchangedOldPath' },
            newPath: { status: 200, golden: 'emptyPatch200UnchangedNewPath' },
            keepsStoredLastUpdated: true
        },
        {
            name: 'invalidPatchTestOp400',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [{ op: 'test', path: '/name/0/family', value: 'NotParity' }],
            status: 400,
            golden: 'invalidPatchTestOp400'
        },
        {
            name: 'invalidPatchMissingPath400',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [{ op: 'replace', value: 'Gamma' }],
            status: 400,
            golden: 'invalidPatchMissingPath400'
        },
        {
            name: 'auditEventPatch405',
            type: 'AuditEvent',
            id: auditEventResource.id,
            body: [{ op: 'replace', path: '/action', value: 'U' }],
            status: 405,
            golden: 'auditEventPatch405'
        }
    ];

    const lookupAndAccessCases = [
        {
            name: 'byUuid200',
            type: 'Patient',
            id: patientUuid,
            previous: [patientResource],
            body: [renameOperation],
            status: 200,
            golden: 'byUuid200'
        },
        {
            name: 'byIdWithAuthority200',
            type: 'Patient',
            id: `${patientResource.id}|client`,
            previous: [patientResource],
            body: [renameOperation],
            status: 200,
            golden: 'byIdWithAuthority200'
        },
        {
            name: 'notFound404',
            type: 'Patient',
            id: patientResource.id,
            body: [renameOperation],
            status: 404,
            golden: 'notFound404'
        },
        {
            name: 'multipleMatches400',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource, patientSameIdOtherOwner],
            body: [renameOperation],
            status: 400,
            golden: 'multipleMatches400'
        },
        {
            name: 'otherTenantOnly404',
            type: 'Patient',
            id: patientOtherTenantResource.id,
            previous: [patientOtherTenantResource],
            body: [renameOperation],
            headers: clientOnlyHeaders,
            status: 404,
            golden: 'otherTenantOnly404'
        },
        {
            name: 'noUpdateScope403',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [renameOperation],
            headers: patchHeaders('user/*.read access/*.*'),
            status: 403,
            golden: 'noUpdateScope403'
        },
        {
            name: 'storedNotAccessible403',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientTwoAccessTags],
            body: [renameOperation],
            headers: otherClientOnlyHeaders,
            status: 403,
            golden: 'storedNotAccessible403'
        },
        {
            name: 'patientScopeForbidden403',
            type: 'Organization',
            id: organizationResource.id,
            previous: [personResource, organizationResource],
            body: [{ op: 'replace', path: '/active', value: false }],
            headers: patientAndUserScopeHeaders,
            status: 403,
            golden: 'patientScopeForbidden403'
        }
    ];

    const accessTagCases = [
        {
            name: 'accessTagChangeForbidden403',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [addOtherAccessTagOperation],
            headers: clientOnlyHeaders,
            status: 403,
            golden: 'accessTagChangeForbidden403'
        },
        {
            name: 'accessTagChangeAllowed200',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [addOtherAccessTagOperation],
            headers: patchHeaders('user/*.* access/*.*'),
            status: 200,
            golden: 'accessTagChangeAllowed200'
        },
        {
            name: 'ownerTagChangeReverted',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [
                { op: 'replace', path: '/meta/security/1/code', value: 'other-client' },
                renameOperation
            ],
            status: 200,
            golden: 'ownerTagChangeReverted'
        },
        {
            name: 'sourceChangeReverted',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [
                { op: 'replace', path: '/meta/source', value: 'http://example.com/other-source' },
                renameOperation
            ],
            status: 200,
            golden: 'sourceChangeReverted'
        }
    ];

    const validationCases = [
        {
            name: 'invalidMeta400',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [
                {
                    op: 'add',
                    path: '/meta/security/-',
                    value: { system: 'https://www.icanbwell.com/access', code: 'null' }
                }
            ],
            status: 400,
            golden: 'invalidMeta400'
        },
        {
            name: 'invalidSchema400',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [invalidBirthDateOperation],
            status: 400,
            golden: 'invalidSchema400'
        },
        {
            name: 'invalidReference400',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [
                {
                    op: 'add',
                    path: '/managingOrganization',
                    value: { reference: 'not-a-reference' }
                }
            ],
            status: 400,
            golden: 'invalidReference400'
        },
        {
            name: 'personLinkOtherTenant400',
            type: 'Person',
            id: personWithoutLinksResource.id,
            previous: [patientOtherTenantResource, personWithoutLinksResource],
            body: [
                {
                    op: 'add',
                    path: '/link',
                    value: [{ target: { reference: `Patient/${patientOtherTenantResource.id}` } }]
                }
            ],
            headers: clientOnlyHeaders,
            status: 400,
            golden: 'personLinkOtherTenant400'
        },
        {
            name: 'groupOverMemberLimit400',
            type: 'Group',
            id: groupResource.id,
            previous: [variant(groupResource, { member: groupMembers(1) })],
            env: { GROUP_MEMBER_MAX_ENTRIES_PER_MEMBER: '1' },
            body: [
                { op: 'add', path: '/member/-', value: groupMember(0, { inactive: true }) },
                { op: 'add', path: '/member/-', value: groupMember(0, { inactive: false }) },
                { op: 'add', path: '/member/-', value: groupMember(0) }
            ],
            status: 400,
            golden: 'groupOverMemberLimit400'
        }
    ];

    const writeCases = [
        {
            name: 'replaceField200',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [renameOperation],
            status: 200,
            golden: 'replaceField200'
        },
        {
            name: 'addToArray200',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [{ op: 'add', path: '/name/-', value: { family: 'Parity', given: ['Delta'] } }],
            status: 200,
            golden: 'addToArray200'
        },
        {
            name: 'removeFromArray200',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientTwoNames],
            body: [{ op: 'remove', path: '/name/1' }],
            status: 200,
            golden: 'removeFromArray200'
        },
        {
            name: 'datePatch200',
            type: 'Composition',
            id: compositionResource.id,
            previous: [compositionResource],
            body: [{ op: 'replace', path: '/date', value: '2026-02-02T00:00:00.000Z' }],
            status: 200,
            golden: 'datePatch200'
        },
        {
            name: 'noOpDoesNotWrite',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [{ op: 'replace', path: '/name/0/family', value: 'Parity' }],
            /**
             * Accepted difference: a no-op PATCH answers `updated: false` with the stored document
             * and stores an access-log entry on the new path. Neither path bumps the version or
             * writes a history row or an AuditEvent.
             */
            old: { status: 200, golden: 'noOpDoesNotWriteOldPath' },
            newPath: { status: 200, golden: 'noOpDoesNotWriteNewPath' },
            keepsStoredLastUpdated: true
        },
        {
            name: 'versionBumpsByOne',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource, patientRenamed],
            body: [{ op: 'replace', path: '/name/0/given/0', value: 'Delta' }],
            status: 200,
            golden: 'versionBumpsByOne'
        }
    ];

    const groupCases = [
        {
            name: 'memberAddedDuplicateMerged',
            type: 'Group',
            id: groupResource.id,
            previous: [variant(groupResource, { member: groupMembers(2) })],
            body: [
                {
                    op: 'add',
                    path: '/member/-',
                    value: groupMember(0, { period: { start: '2026-01-01' } })
                }
            ],
            status: 200,
            golden: 'memberAddedDuplicateMerged'
        },
        {
            name: 'memberRemoved',
            type: 'Group',
            id: groupResource.id,
            previous: [variant(groupResource, { member: groupMembers(2) })],
            body: [{ op: 'remove', path: '/member/0' }],
            status: 200,
            golden: 'memberRemoved'
        },
        {
            name: 'memberAddOverPromotionLimitPromotes',
            type: 'Group',
            id: groupResource.id,
            storeEnv: promotionEnvironment,
            previous: [variant(groupResource, { member: groupMembers(3) })],
            env: promotionEnvironment,
            body: [{ op: 'add', path: '/member/-', value: groupMember(3) }],
            status: 200,
            golden: 'memberAddOverPromotionLimitPromotes'
        }
    ];

    const attachmentCases = [
        {
            name: 'gridFsAttachmentRemoved',
            type: 'DocumentReference',
            id: documentReferenceResource.id,
            previous: [documentReferenceResource],
            body: [{ op: 'remove', path: '/content/0/attachment/data' }],
            status: 200,
            golden: 'gridFsAttachmentRemoved'
        },
        {
            name: 'base64ValueUnchangedUploadsAgain',
            type: 'Binary',
            id: binaryResource.id,
            previous: [binaryResource],
            body: [{ op: 'replace', path: '/contentType', value: 'application/xml' }],
            status: 200,
            golden: 'base64ValueUnchangedUploadsAgain'
        }
    ];

    const perPathCases = [
        {
            name: 'validationBeforeAccessTagCheck',
            type: 'Patient',
            id: patientResource.id,
            previous: [patientResource],
            body: [addOtherAccessTagOperation, invalidBirthDateOperation],
            headers: clientOnlyHeaders,
            /**
             * Accepted difference: the new path validates the patched resource before it checks
             * the access-tag change, so a patch that fails both gets the validation 400; the old
             * path checks the access tags first and answers 403.
             */
            old: { status: 403, golden: 'validationBeforeAccessTagCheckOldPath' },
            newPath: { status: 400, golden: 'validationBeforeAccessTagCheckNewPath' }
        }
    ];

    const cases = [
        ...requestCheckCases,
        ...lookupAndAccessCases,
        ...accessTagCases,
        ...validationCases,
        ...writeCases,
        ...groupCases,
        ...attachmentCases,
        ...perPathCases
    ];

    test.each(runsOf(cases))('$name on the $path path', async ({
        path: writePath,
        type,
        id,
        storeEnv = {},
        previous = [],
        env = {},
        body,
        headers = patchHeaders(),
        expectation,
        keepsStoredLastUpdated = false
    }) => {
        const request = await createTestRequest(registerMockClients);
        const { accessLogger, auditLogger } = getTestContainer();
        const logAccessLogAsync = jest.spyOn(accessLogger, 'logAccessLogAsync');
        const logAuditEntryAsync = jest.spyOn(auditLogger, 'logAuditEntryAsync');
        const logErrorAuditEntryAsync = jest.spyOn(auditLogger, 'logErrorAuditEntryAsync');
        useWritePath('old');
        Object.assign(process.env, storeEnv);
        for (const resource of previous) {
            const stored = await storeResource(request, resource);
            expect(stored.status).toBe(200);
            expect(stored.body.created || stored.body.updated).toBe(true);
        }
        await waitForPostRequestTasks();
        const [storedBefore] = await readStoredDocuments(type);
        const liveKeyBefore = liveKeyOf(storedBefore);
        await delay(100);
        logAccessLogAsync.mockClear();
        logAuditEntryAsync.mockClear();
        logErrorAuditEntryAsync.mockClear();
        Object.assign(process.env, env);
        useWritePath(writePath);

        const resp = await patchResource(request, { type, id, body, headers });

        expect(resp.status).toBe(expectation.status);
        resp.body = maskInstantsInOutcome(resp.body);
        if (resp.status === 200) {
            expect(resp.body.meta.lastUpdated).toMatch(INSTANT_PATTERN);
        }
        const goldenState = RECORDING ? undefined : readGolden(`${expectation.golden}State`);
        const documents = await readStoredDocuments(type);
        const history = await readSettledHistoryRows(type, goldenState?.history.length);
        const gridFsFiles = await readGridFsFiles();
        const gridFsFileIds = gridFsFiles.map((file) => file._id.toString());
        const accessLogCalls = await waitForAccessLogCalls(logAccessLogAsync);
        const liveKeyAfter = liveKeyOf(documents[0]);
        if (keepsStoredLastUpdated) {
            expect(documents[0].meta.lastUpdated).toStrictEqual(storedBefore.meta.lastUpdated);
        }
        const succeeded = resp.status >= 200 && resp.status < 300;
        const { uploadedData } = getTestContainer().base64FieldCloudStorageClient;
        const state = {
            headers: {
                ...(succeeded ? { etag: resp.headers.etag ?? null } : {}),
                location: resp.headers.location ?? null,
                contentLocation: resp.headers['content-location'] ?? null
            },
            documents: normalizeStored(documents, gridFsFileIds),
            history: normalizeStored(history, gridFsFileIds),
            gridFsFileActive: gridFsFiles.map((file) => file.metadata?.active ?? null),
            accessLog: summarizeAccessLogCalls(accessLogCalls),
            audit: summarizeAuditCalls({
                entryCalls: logAuditEntryAsync.mock.calls,
                errorCalls: logErrorAuditEntryAsync.mock.calls
            }),
            ...(type === 'Group'
                ? { groupMembers: normalizeStored(await readGroupMemberRows(), gridFsFileIds) }
                : {}),
            ...(type === 'Binary'
                ? {
                      liveKeyChanged: liveKeyBefore !== liveKeyAfter,
                      liveData: uploadedData[liveKeyAfter] ?? null
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
});
