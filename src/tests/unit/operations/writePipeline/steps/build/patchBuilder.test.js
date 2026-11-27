const { describe, test, expect, jest } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { PreSaveManager } = require('../../../../../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../../../../../preSaveHandlers/preSaveOptions');
const { ResourceMerger } = require('../../../../../../operations/common/resourceMerger');
const { GroupMemberMerger } = require('../../../../../../operations/common/groupMemberMerger');
const { GroupMemberPatchStrategy } = require('../../../../../../operations/patch/strategies/groupMemberPatchStrategy');
const { DatabaseAttachmentManager } = require('../../../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../../../dataLayer/base64DataManager');
const { FhirRequestInfo } = require('../../../../../../utils/fhirRequestInfo');
const { USE_EXTERNAL_STORAGE_HEADER } = require('../../../../../../utils/contextDataBuilder');
const { PatchBuilder } = require('../../../../../../operations/writePipeline/steps/build/patchBuilder');
const { BuildDocumentStep } = require('../../../../../../operations/writePipeline/steps/buildDocumentStep');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { GRIDFS: { RETRIEVE }, BLOB_OP, SENSITIVE_CATEGORY } = require('../../../../../../constants');
const { generateUUIDv5 } = require('../../../../../../utils/uid.util');

const OWNER_SYSTEM = 'https://www.icanbwell.com/owner';
const SAA_SYSTEM = 'https://www.icanbwell.com/sourceAssigningAuthority';
const ACCESS_SYSTEM = 'https://www.icanbwell.com/access';
const STORED_SOURCE = 'https://example.test/source';
const STORED_LAST_UPDATED = '2024-01-01T00:00:00.000Z';

/**
 * Builds a synthetic stored document, as the lookup step reads it, at version 3 with an owner, an
 * access and a source assigning authority tag.
 * @param {string} resourceType
 * @param {string} id
 * @param {Object} fields
 * @returns {Object}
 */
const storedDoc = ({ resourceType = 'Patient', id = 'patient-1', ...fields } = {}) => ({
    resourceType,
    id,
    meta: {
        versionId: '3',
        lastUpdated: STORED_LAST_UPDATED,
        source: STORED_SOURCE,
        security: [
            { system: OWNER_SYSTEM, code: 'owner' },
            { system: ACCESS_SYSTEM, code: 'owner' },
            { system: SAA_SYSTEM, code: 'owner' }
        ]
    },
    _uuid: generateUUIDv5(`${id}|owner`),
    _sourceAssigningAuthority: 'owner',
    ...fields
});

/**
 * Builds a synthetic stored Patient.
 * @param {Object} fields
 * @returns {Object}
 */
const storedPatient = (fields = {}) => storedDoc({
    name: [{ family: 'Synthetic', given: ['Test'] }],
    gender: 'male',
    ...fields
});

/**
 * Builds a synthetic stored Group.
 * @param {Object} fields
 * @returns {Object}
 */
const storedGroup = (fields = {}) => storedDoc({
    resourceType: 'Group',
    id: 'group-1',
    type: 'person',
    actual: true,
    name: 'Synthetic group',
    ...fields
});

/**
 * Builds a configManager with the given extended Group and ClickHouse settings.
 * @param {boolean} enableExtendedGroup
 * @param {boolean} clickHouseGroup
 * @returns {ConfigManager}
 */
const buildConfigManager = ({ enableExtendedGroup, clickHouseGroup }) => {
    const configManager = new ConfigManager();
    Object.defineProperty(configManager, 'enableExtendedGroup', { get: () => enableExtendedGroup });
    Object.defineProperty(configManager, 'enableClickHouse', { get: () => clickHouseGroup });
    Object.defineProperty(configManager, 'mongoWithClickHouseResources', {
        get: () => (clickHouseGroup ? ['Group'] : [])
    });
    return configManager;
};

/**
 * Builds an attachment manager whose GridFS read is the given function, and a pass-through by
 * default.
 * @param {function(Object, string, Array): Promise<Object>} transformAttachments
 * @returns {DatabaseAttachmentManager}
 */
const buildAttachmentManager = (transformAttachments = async (resource) => resource) => {
    const manager = Object.create(DatabaseAttachmentManager.prototype);
    manager.transformAttachments = jest.fn(transformAttachments);
    return manager;
};

/**
 * Builds a base64 manager whose cloud read is the given function, and a pass-through by default.
 * @param {function(Object, string, Object): Promise<Object>} transformAsync
 * @returns {Base64DataManager}
 */
const buildBase64Manager = (transformAsync = async (resource) => resource) => {
    const manager = Object.create(Base64DataManager.prototype);
    manager.transformAsync = jest.fn(transformAsync);
    return manager;
};

/**
 * Builds the builder with the real merger, member merger and member strategy, a pass-through
 * preSave, and fakes at the boundaries: the attachment managers, the post-save handler factory
 * (a ClickHouse handler for Group only when `clickHouseGroup` is set), the bulk inserter and the
 * Group member repository, whose resolved writes are `resolvedMemberWrites`.
 * @param {boolean} enableExtendedGroup
 * @param {boolean} clickHouseGroup
 * @param {Map} resolvedMemberWrites
 * @param {DatabaseAttachmentManager} databaseAttachmentManager
 * @param {Base64DataManager} base64DataManager
 * The preSave fake and the real member merger's `mergeMembers` record their calls, in order, in
 * `callLog`.
 * @returns {{builder: PatchBuilder, configManager: ConfigManager, preSaveManager: PreSaveManager,
 *     callLog: string[], clickHouseHandler: Object, bulkInserter: Object,
 *     mongoGroupMemberRepository: Object}}
 */
const buildBuilder = ({
    enableExtendedGroup = true,
    clickHouseGroup = false,
    resolvedMemberWrites = new Map(),
    databaseAttachmentManager = buildAttachmentManager(),
    base64DataManager = buildBase64Manager()
} = {}) => {
    const configManager = buildConfigManager({ enableExtendedGroup, clickHouseGroup });
    const callLog = [];
    const preSaveManager = Object.create(PreSaveManager.prototype);
    preSaveManager.preSaveAsync = jest.fn(async ({ resource }) => {
        callLog.push('preSave');
        return resource;
    });
    const groupMemberMerger = new GroupMemberMerger({ configManager });
    const realMergeMembers = groupMemberMerger.mergeMembers.bind(groupMemberMerger);
    jest.spyOn(groupMemberMerger, 'mergeMembers').mockImplementation((args) => {
        callLog.push('mergeMembers');
        return realMergeMembers(args);
    });
    const resourceMerger = new ResourceMerger({ preSaveManager, configManager, groupMemberMerger });
    const clickHouseHandler = { writeEventsAsync: jest.fn() };
    const bulkInserter = { replaceOneAsync: jest.fn(), executeAsync: jest.fn() };
    const mongoGroupMemberRepository = {
        resolveMemberWritesAsync: jest.fn(async () => resolvedMemberWrites),
        applyResolvedMemberWritesAsync: jest.fn()
    };
    const groupMemberPatchStrategy = new GroupMemberPatchStrategy({
        postSaveHandlerFactory: {
            getHandlers: (resourceType) =>
                (clickHouseGroup && resourceType === 'Group' ? [clickHouseHandler] : [])
        },
        configManager,
        resourceMerger,
        databaseBulkInserter: bulkInserter,
        mongoGroupMemberRepository
    });
    const builder = new PatchBuilder({
        resourceMerger,
        preSaveManager,
        groupMemberMerger,
        groupMemberPatchStrategy,
        databaseAttachmentManager,
        base64DataManager
    });
    return {
        builder,
        configManager,
        preSaveManager,
        callLog,
        clickHouseHandler,
        bulkInserter,
        mongoGroupMemberRepository
    };
};

/**
 * Builds a PATCH request info with the given headers.
 * @param {Object} headers
 * @returns {FhirRequestInfo}
 */
const buildRequestInfo = (headers = {}) => new FhirRequestInfo({
    user: 'test-user',
    scope: 'user/*.* access/*.*',
    requestId: 'request-1',
    protocol: 'https',
    originalUrl: '/4_0_0/Patient/patient-1',
    host: 'localhost',
    headers,
    method: 'PATCH'
});

/**
 * Builds a PATCH item as the responder and the lookup step leave it: the stub body, the patch
 * and the stored document.
 * @param {Object} stored
 * @param {Object[]} patch
 * @returns {WriteItem}
 */
const buildItem = ({ stored, patch }) => {
    const item = new WriteItem({
        index: 0,
        incoming: {
            resourceType: stored.resourceType,
            id: stored.id,
            _uuid: stored._uuid,
            _sourceAssigningAuthority: stored._sourceAssigningAuthority
        }
    });
    item.stored = stored;
    item.patch = patch;
    return item;
};

/**
 * Builds a write context for the given headers.
 * @param {Object} headers
 * @returns {WriteContext}
 */
const buildContext = (headers = {}) => new WriteContext({
    requestInfo: buildRequestInfo(headers),
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

/**
 * Builds the item for the stored document and patch, runs the builder on it and returns the item,
 * the returned failure, the context and a copy of the stored document taken before the build.
 * @param {Object} stored
 * @param {Object[]} patch
 * @param {Object} headers
 * @param {Object} builderOptions
 * @returns {Promise<{item: WriteItem, failure: Object|null, context: WriteContext, storedBefore: Object}>}
 */
const runBuild = async ({ stored, patch, headers = {}, ...builderOptions }) => {
    const item = buildItem({ stored, patch });
    const storedBefore = deepcopy(stored);
    const { builder } = buildBuilder(builderOptions);
    const context = buildContext(headers);
    const failure = await builder.buildAsync({ item, context });
    return { item, failure, context, storedBefore };
};

/**
 * Builds the item and runs it through the `buildDocument` step with the builder, returning the
 * item so a thrown build error can be read off its failure.
 * @param {Object} stored
 * @param {Object[]} patch
 * @param {Object} headers
 * @param {Object} builderOptions
 * @returns {Promise<WriteItem>}
 */
const runBuildStep = async ({ stored, patch, headers = {}, ...builderOptions }) => {
    const item = buildItem({ stored, patch });
    const { builder, configManager } = buildBuilder(builderOptions);
    const step = new BuildDocumentStep({ builder, configManager });
    await step.runAsync({ items: [item], context: buildContext(headers) });
    return item;
};

/**
 * A JSON Patch operation that renames the synthetic Group.
 */
const RENAME_GROUP = Object.freeze({ op: 'replace', path: '/name', value: 'Renamed group' });

/**
 * Returns the code of the candidate's security tag of the given system.
 * @param {Object} candidate
 * @param {string} system
 * @returns {string|undefined}
 */
const tagCode = (candidate, system) => candidate.meta.security.find((tag) => tag.system === system)?.code;

/**
 * Builds a JSON Patch operation on a Group's members for the given member reference.
 * @param {string} op
 * @param {string} reference
 * @param {string} path
 * @param {Object} fields - other fields of the member entry
 * @returns {Object}
 */
const memberOp = (op, reference, path = '/member/-', fields = {}) => ({
    op,
    path,
    value: { entity: { reference }, ...fields }
});

/**
 * Returns a document without its `meta`.
 * @param {Object} resource
 * @returns {Object}
 */
const withoutMeta = ({ meta: _meta, ...rest }) => rest;

describe('PatchBuilder', () => {
    test('applies an add, a replace and a remove in one patch and builds an update', async () => {
        const { item, failure } = await runBuild({
            stored: storedPatient({ birthDate: '1990-01-01' }),
            patch: [
                { op: 'add', path: '/active', value: true },
                { op: 'replace', path: '/gender', value: 'female' },
                { op: 'remove', path: '/birthDate' }
            ]
        });

        expect(failure).toBeNull();
        expect(item.writeMode).toBe('update');
        expect(item.memberWrites).toBeNull();
        expect(item.candidate.active).toBe(true);
        expect(item.candidate.gender).toBe('female');
        expect(item.candidate.birthDate).toBeUndefined();
        expect(item.appliedPatch).toEqual(expect.arrayContaining([
            { op: 'add', path: '/active', value: true },
            { op: 'replace', path: '/gender', value: 'female' },
            { op: 'remove', path: '/birthDate' }
        ]));
        expect(item.appliedPatch).toHaveLength(3);
    });

    test('applies an add to a nested path', async () => {
        const { item } = await runBuild({
            stored: storedPatient(),
            patch: [{ op: 'add', path: '/name/0/given/-', value: 'Second' }]
        });

        expect(item.candidate.name).toEqual([{ family: 'Synthetic', given: ['Test', 'Second'] }]);
    });

    test('bumps the version from the stored version and sets a new lastUpdated', async () => {
        const { item } = await runBuild({
            stored: storedPatient(),
            patch: [{ op: 'replace', path: '/gender', value: 'female' }]
        });

        expect(item.candidate.meta.versionId).toBe('4');
        expect(item.candidate.meta.lastUpdated).toBeInstanceOf(Date);
        expect(item.candidate.meta.lastUpdated.toISOString()).not.toBe(STORED_LAST_UPDATED);
    });

    test('keeps the stored document as read', async () => {
        const { item, storedBefore } = await runBuild({
            stored: storedPatient({ birthDate: '1990-01-01' }),
            patch: [
                { op: 'add', path: '/name/0/given/-', value: 'Second' },
                { op: 'replace', path: '/gender', value: 'female' },
                { op: 'remove', path: '/birthDate' }
            ]
        });

        expect(item.stored).toEqual(storedBefore);
        expect(item.candidate).not.toBe(item.stored);
    });

    test.each([
        {
            name: 'a failing test operation',
            patch: [{ op: 'test', path: '/gender', value: 'female' }],
            message: 'Test operation failed'
        },
        {
            name: 'a remove of a missing path',
            patch: [{ op: 'remove', path: '/birthDate' }],
            message: 'Cannot perform the operation at a path that does not exist'
        },
        {
            name: 'a replace under a missing path',
            patch: [{ op: 'replace', path: '/telecom/0/value', value: 'x' }],
            message: 'Cannot perform the operation at a path that does not exist'
        }
    ])('$name fails the item at BUILD with the 400 the old path throws', async ({ patch, message }) => {
        const item = await runBuildStep({ stored: storedPatient(), patch });

        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.BUILD);
        expect(item.failure.error.statusCode).toBe(400);
        expect(item.failure.error.message.startsWith(message)).toBe(true);
        expect(item.candidate).toBeNull();
    });

    test.each([
        {
            name: 'the owner tag',
            patch: [{ op: 'replace', path: '/meta/security/0/code', value: 'other-owner' }],
            read: (candidate) => tagCode(candidate, OWNER_SYSTEM),
            expected: 'owner'
        },
        {
            name: 'the source assigning authority tag',
            patch: [{ op: 'replace', path: '/meta/security/2/code', value: 'other-owner' }],
            read: (candidate) => tagCode(candidate, SAA_SYSTEM),
            expected: 'owner'
        },
        {
            name: 'meta.source',
            patch: [{ op: 'replace', path: '/meta/source', value: 'https://example.test/other' }],
            read: (candidate) => candidate.meta.source,
            expected: STORED_SOURCE
        },
        {
            name: 'the id',
            patch: [{ op: 'replace', path: '/id', value: 'patient-2' }],
            read: (candidate) => candidate.id,
            expected: 'patient-1'
        }
    ])('a change to $name is reverted in the candidate', async ({ patch, read, expected }) => {
        const { item } = await runBuild({
            stored: storedPatient(),
            patch: [...patch, { op: 'replace', path: '/gender', value: 'female' }]
        });

        expect(read(item.candidate)).toBe(expected);
        expect(item.candidate.gender).toBe('female');
    });

    test.each([
        {
            name: 'a patch that sets a field to its stored value',
            patch: [{ op: 'replace', path: '/gender', value: 'male' }]
        },
        {
            name: 'a patch that only changes meta.source',
            patch: [{ op: 'replace', path: '/meta/source', value: 'https://example.test/other' }]
        },
        {
            name: 'a passing test operation alone',
            patch: [{ op: 'test', path: '/gender', value: 'male' }]
        }
    ])('$name leaves the candidate null and the applied patch empty', async ({ patch }) => {
        const { item, failure } = await runBuild({ stored: storedPatient(), patch });

        expect(failure).toBeNull();
        expect(item.candidate).toBeNull();
        expect(item.writeMode).toBe('update');
        expect(item.appliedPatch).toEqual([]);
    });

    test.each([
        {
            name: 'an unknown field alone',
            patch: [{ op: 'add', path: '/notAFhirField', value: 'x' }]
        },
        {
            name: 'an unknown field with a real change',
            patch: [
                { op: 'add', path: '/notAFhirField', value: 'x' },
                { op: 'replace', path: '/gender', value: 'female' }
            ]
        },
        {
            name: 'an unknown nested field',
            patch: [{ op: 'add', path: '/name/0/notAFhirField', value: 'x' }]
        }
    ])('a patch that adds $name fails at RESULT_VALIDATION with the schema outcome', async ({
        patch
    }) => {
        const stored = storedPatient();
        const { item, failure } = await runBuild({ stored, patch });

        expect(failure.stage).toBe(WRITE_FAILURE_STAGE.RESULT_VALIDATION);
        expect(failure.subject).toEqual({
            id: stored.id,
            uuid: stored._uuid,
            sourceAssigningAuthority: stored._sourceAssigningAuthority,
            resourceType: 'Patient'
        });
        expect(failure.operationOutcome.issue[0].details.text).toContain('notAFhirField');
        expect(item.candidate).toBeNull();
        expect(item.appliedPatch).toBeNull();
    });

    test('a stored document with a Date and internal fields passes the schema check', async () => {
        const { item, failure } = await runBuild({
            stored: storedPatient({
                meta: {
                    ...storedPatient().meta,
                    lastUpdated: new Date(STORED_LAST_UPDATED)
                },
                _access: { owner: 1 }
            }),
            patch: [{ op: 'replace', path: '/gender', value: 'female' }]
        });

        expect(failure).toBeNull();
        expect(item.candidate.gender).toBe('female');
    });

    test('hydrates a copy of the stored document before validating and applying the patch', async () => {
        const databaseAttachmentManager = buildAttachmentManager(async (resource) => {
            resource.photo = resource.photo.map(({ _file_id: _fileId, ...photo }) => ({
                ...photo,
                data: 'Z3JpZGZz'
            }));
            return resource;
        });
        const base64DataManager = buildBase64Manager(async (resource) => {
            resource.photo = resource.photo.map((photo) => ({
                ...photo,
                title: 'from cloud storage'
            }));
            return resource;
        });
        const patch = [
            { op: 'test', path: '/photo/0/data', value: 'Z3JpZGZz' },
            { op: 'replace', path: '/gender', value: 'female' }
        ];
        const { item, failure, context, storedBefore } = await runBuild({
            stored: storedPatient({ photo: [{ contentType: 'image/png', _file_id: 'file-1' }] }),
            patch,
            databaseAttachmentManager,
            base64DataManager
        });

        expect(failure).toBeNull();
        expect(item.stored).toEqual(storedBefore);
        const [gridFsInput, gridFsOperation, gridFsPatch] =
            databaseAttachmentManager.transformAttachments.mock.calls[0];
        expect(gridFsInput).not.toBe(item.stored);
        expect(gridFsOperation).toBe(RETRIEVE);
        expect(gridFsPatch).toEqual(patch);
        const [, base64Operation, base64RequestInfo] = base64DataManager.transformAsync.mock.calls[0];
        expect(base64Operation).toBe(BLOB_OP.RETRIEVE);
        expect(base64RequestInfo).toBe(context.requestInfo);
        expect(item.candidate.photo).toEqual([
            { contentType: 'image/png', data: 'Z3JpZGZz', title: 'from cloud storage' }
        ]);
    });

    test('runs preSave once on the patched resource with the request options, before the member merge', async () => {
        const item = buildItem({
            stored: storedPatient(),
            patch: [{ op: 'replace', path: '/gender', value: 'female' }]
        });
        const { builder, preSaveManager, callLog } = buildBuilder();
        const context = buildContext({ [SENSITIVE_CATEGORY.SUPPRESS_HEADER]: 'true' });

        await builder.buildAsync({ item, context });

        expect(preSaveManager.preSaveAsync).toHaveBeenCalledTimes(1);
        const [{ resource, options }] = preSaveManager.preSaveAsync.mock.calls[0];
        expect(resource).toBe(item.candidate);
        expect(resource.gender).toBe('female');
        expect(options).toEqual(PreSaveOptions.fromRequestInfo(context.requestInfo));
        expect(options.suppressUnclassifiedTag).toBe(true);
        expect(callLog).toEqual(['preSave', 'mergeMembers']);
    });

    test('an embedded Group stored with a repeated member keeps one entry for it', async () => {
        const { item } = await runBuild({
            stored: storedGroup({
                member: [
                    { entity: { reference: 'Patient/member-1' }, inactive: false },
                    { entity: { reference: 'Patient/member-2' } },
                    { entity: { reference: 'Patient/member-1' }, period: { start: '2024-01-01' } }
                ]
            }),
            patch: [RENAME_GROUP]
        });

        expect(item.memberWrites).toBeNull();
        expect(item.candidate.member).toEqual([
            {
                entity: { reference: 'Patient/member-1' },
                inactive: false,
                period: { start: '2024-01-01' }
            },
            { entity: { reference: 'Patient/member-2' } }
        ]);
    });

    test('an entry the patch inserts at the front of an embedded Group wins over the stored entry', async () => {
        const { item } = await runBuild({
            stored: storedGroup({
                member: [{ entity: { reference: 'Patient/member-1' }, inactive: false }]
            }),
            patch: [memberOp('add', 'Patient/member-1', '/member/0', { inactive: true })]
        });

        expect(item.memberWrites).toBeNull();
        expect(item.candidate.member).toEqual([
            { entity: { reference: 'Patient/member-1' }, inactive: true }
        ]);
        expect(item.candidate.meta.versionId).toBe('4');
    });

    test('an extended Group keeps only the non-member operations and sets its member writes', async () => {
        const resolvedMemberWrites = new Map([['member-1', { writeType: 'create' }]]);
        const { item } = await runBuild({
            stored: storedGroup({ _extended: true }),
            patch: [
                memberOp('add', 'Patient/member-1'),
                RENAME_GROUP
            ],
            resolvedMemberWrites
        });

        expect(item.memberWrites).toEqual({
            type: 'extended',
            memberOperationCount: 1,
            pendingMemberWrites: resolvedMemberWrites,
            hasPendingMemberWrites: true,
            sourceAssigningAuthority: 'owner'
        });
        expect(item.appliedPatch).toEqual([RENAME_GROUP]);
        expect(item.candidate.name).toBe('Renamed group');
        expect(item.candidate.member).toBeUndefined();
        expect(item.candidate._extended).toBe(true);
    });

    test.each([
        { writeType: 'create', bumped: true },
        { writeType: 'none', bumped: false }
    ])('an extended Group member-only patch with a $writeType member write bumps: $bumped', async ({
        writeType,
        bumped
    }) => {
        const { item } = await runBuild({
            stored: storedGroup({ _extended: true }),
            patch: [memberOp('add', 'Patient/member-1')],
            resolvedMemberWrites: new Map([['member-1', { writeType }]])
        });

        expect(item.appliedPatch).toEqual([]);
        expect(item.memberWrites.hasPendingMemberWrites).toBe(bumped);
        expect(item.candidate?.meta.versionId ?? null).toBe(bumped ? '4' : null);
    });

    test('an extended Group with extended Groups disabled fails with the old 400', async () => {
        const item = await runBuildStep({
            stored: storedGroup({ _extended: true }),
            patch: [memberOp('add', 'Patient/member-1')],
            enableExtendedGroup: false
        });

        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.BUILD);
        expect(item.failure.error.statusCode).toBe(400);
        expect(item.failure.error.message).toBe(
            'Group group-1 uses a member-management feature that is disabled on this server.'
        );
    });

    test('an external storage Group with an unsupported member operation fails with the old 400', async () => {
        const item = await runBuildStep({
            stored: storedGroup({ member: [{ entity: { reference: 'Patient/member-1' } }] }),
            patch: [{ op: 'remove', path: '/member/0' }],
            headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' },
            clickHouseGroup: true
        });

        expect(item.failure.stage).toBe(WRITE_FAILURE_STAGE.BUILD);
        expect(item.failure.error.statusCode).toBe(400);
        expect(item.failure.error.message).toBe(
            'Unsupported PATCH operation on Group.member: remove /member/0. ' +
            'Supported paths: "/member/" or "/member/-". Supported operations: ' +
            '1) Add member: {"op":"add","path":"/member/-","value":{"entity":{"reference":"Patient/123"}}} ' +
            '2) Remove member: {"op":"remove","path":"/member/-","value":{"entity":{"reference":"Patient/123"}}}'
        );
        expect(item.failure.error.issue).toEqual([
            { severity: 'error', code: 'not-supported', diagnostics: item.failure.error.message }
        ]);
        expect(item.memberWrites).toBeNull();
        expect(item.candidate).toBeNull();
    });

    test('an extended Group patch with no member operation does not check the member type', async () => {
        const { item, failure } = await runBuild({
            stored: storedGroup({ _extended: true }),
            patch: [RENAME_GROUP],
            enableExtendedGroup: false
        });

        expect(failure).toBeNull();
        expect(item.memberWrites).toBeNull();
        expect(item.candidate.name).toBe('Renamed group');
    });

    test('an external storage Group member-only patch sets its events and changes only the meta', async () => {
        const { item, storedBefore } = await runBuild({
            stored: storedGroup({ member: [{ entity: { reference: 'Patient/member-1' } }] }),
            patch: [
                memberOp('add', 'Patient/member-2'),
                memberOp('remove', 'Patient/member-1')
            ],
            headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' },
            clickHouseGroup: true
        });

        expect(item.memberWrites).toEqual({
            type: 'externalStorage',
            memberOperationCount: 2,
            events: {
                eventsToAdd: [{
                    entity: expect.objectContaining({
                        reference: 'Patient/member-2',
                        _sourceAssigningAuthority: 'owner'
                    }),
                    period: undefined,
                    inactive: false
                }],
                eventsToRemove: [{
                    entity: expect.objectContaining({
                        reference: 'Patient/member-1',
                        _sourceAssigningAuthority: 'owner'
                    }),
                    period: undefined,
                    inactive: false
                }]
            }
        });
        expect(item.appliedPatch).toEqual([]);
        expect(withoutMeta(item.candidate)).toEqual(withoutMeta(storedBefore));
        expect(item.candidate.meta.versionId).toBe('4');
        expect(item.stored).toEqual(storedBefore);
    });

    test('an external storage Group mixed patch applies only the non-member operations', async () => {
        const { item } = await runBuild({
            stored: storedGroup({ member: [{ entity: { reference: 'Patient/member-1' } }] }),
            patch: [
                memberOp('add', 'Patient/member-2'),
                RENAME_GROUP
            ],
            headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' },
            clickHouseGroup: true
        });

        expect(item.memberWrites.type).toBe('externalStorage');
        expect(item.appliedPatch).toEqual([RENAME_GROUP]);
        expect(item.candidate.member).toEqual([{ entity: { reference: 'Patient/member-1' } }]);
    });

    test.each([
        {
            name: 'an extended Group',
            stored: storedGroup({ _extended: true }),
            headers: {},
            clickHouseGroup: false
        },
        {
            name: 'an external storage Group',
            stored: storedGroup(),
            headers: { [USE_EXTERNAL_STORAGE_HEADER]: 'true' },
            clickHouseGroup: true
        }
    ])('a member patch of $name builds without writing anything', async ({ stored, headers, clickHouseGroup }) => {
        const item = buildItem({
            stored,
            patch: [memberOp('add', 'Patient/member-1')]
        });
        const { builder, clickHouseHandler, bulkInserter, mongoGroupMemberRepository } = buildBuilder({
            clickHouseGroup,
            resolvedMemberWrites: new Map([['member-1', { writeType: 'create' }]])
        });

        await builder.buildAsync({ item, context: buildContext(headers) });

        expect(item.candidate.meta.versionId).toBe('4');
        expect(mongoGroupMemberRepository.applyResolvedMemberWritesAsync).not.toHaveBeenCalled();
        expect(bulkInserter.replaceOneAsync).not.toHaveBeenCalled();
        expect(clickHouseHandler.writeEventsAsync).not.toHaveBeenCalled();
    });
});
