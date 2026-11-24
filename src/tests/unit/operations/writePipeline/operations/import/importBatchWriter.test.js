const { describe, test, expect, jest } = require('@jest/globals');
const { MergeResultEntry } = require('../../../../../../operations/common/mergeResultEntry');
const { MergeManager } = require('../../../../../../operations/merge/mergeManager');
const { ScopesManager } = require('../../../../../../operations/security/scopesManager');
const { ParsedArgs } = require('../../../../../../operations/query/parsedArgs');
const { ImportBatchFlushError } = require('../../../../../../operations/writePipeline/operations/import/importBatchFlushError');
const { ImportBatchWriter } = require('../../../../../../operations/writePipeline/operations/import/importBatchWriter');
const { IMPORT_WRITE_PROFILE } = require('../../../../../../operations/writePipeline/operations/import/profile');
const { ImportResponder } = require('../../../../../../operations/writePipeline/operations/import/responder');
const { ResourceStructureChecker } = require('../../../../../../operations/writePipeline/resourceStructureChecker');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../../../../../operations/writePipeline/writeFailure');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WritePipeline } = require('../../../../../../operations/writePipeline/writePipeline');
const { OwnerColumnHandler } = require('../../../../../../preSaveHandlers/handlers/ownerColumnHandler');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { CustomTracer } = require('../../../../../../utils/customTracer');
const { SecurityTagSystem } = require('../../../../../../utils/securityTagSystem');

const BYTE_OFFSET_URL = 'https://www.icanbwell.com/source-byte-offset';
const UUID_A = '00000000-0000-4000-8000-00000000000a';
const UUID_B = '00000000-0000-4000-8000-00000000000b';
const UUID_C = '00000000-0000-4000-8000-00000000000c';
const REQUEST_INFO = Object.freeze({ requestId: 'synthetic-import-request', headers: {} });

/**
 * Builds a buffered line for a synthetic resource, a Patient unless `resourceType` is given, with
 * the given uuid id and security tags.
 */
const line = ({ uuid, security, byteOffset, resourceType = 'Patient' }) => ({
    fhirResource: {
        resourceType,
        id: uuid,
        _uuid: uuid,
        meta: { security: security.map(([system, code]) => ({ system, code })) }
    },
    byteOffset
});

/**
 * A line with only an access tag, whose owner tag the owner backfill adds.
 */
const accessOnlyLine = (props) =>
    line({ ...props, security: [[SecurityTagSystem.access, 'client-a']] });

/**
 * A line with an owner and an access tag.
 */
const ownedLine = (props) =>
    line({
        ...props,
        security: [
            [SecurityTagSystem.owner, 'client-b'],
            [SecurityTagSystem.access, 'client-b']
        ]
    });

/**
 * Marks every item queued with the given write mode, as the write step does.
 */
const queueAll = (writeModeOf = () => 'insert') => (items) => {
    for (const item of items) {
        item.writeMode = writeModeOf(item);
        item.markQueued();
    }
};

/**
 * The bulk inserter's result for a written Patient.
 */
const flushResult = (uuid) =>
    new MergeResultEntry({
        id: uuid,
        uuid,
        resourceType: 'Patient',
        created: true,
        updated: false
    });

/**
 * The OperationOutcome of the access check failure the fake pipeline records.
 */
const forbiddenOutcome = () => ({
    resourceType: 'OperationOutcome',
    issue: [{ severity: 'error', code: 'forbidden', details: { text: 'synthetic access failure' } }]
});

/**
 * The byte-offset extension a failed entry's issue carries.
 */
const byteOffsetExtension = (byteOffset) => [{ url: BYTE_OFFSET_URL, valueInteger: byteOffset }];

/**
 * An entry of a line that did not fail, as `describeEntry` shows it.
 */
const successEntry = ({ uuid, created, updated, sourceByteOffset }) => ({
    created,
    id: uuid,
    uuid,
    resourceType: 'Patient',
    updated,
    sourceByteOffset
});

/**
 * The entry of a created line.
 */
const createdEntry = (uuid, sourceByteOffset) =>
    successEntry({ uuid, created: true, updated: false, sourceByteOffset });

/**
 * The entry of an updated line.
 */
const updatedEntry = (uuid, sourceByteOffset) =>
    successEntry({ uuid, created: false, updated: true, sourceByteOffset });

/**
 * The issue of the access check failure, with the line's byte-offset extension.
 */
const forbiddenIssue = (byteOffset) => ({
    severity: 'error',
    code: 'forbidden',
    details: { text: 'synthetic access failure' },
    extension: byteOffsetExtension(byteOffset)
});

/**
 * Fails the item with the access check failure of a resource of `client-a`.
 */
const failForbidden = (item) =>
    item.fail({
        failure: new WriteFailure({
            stage: WRITE_FAILURE_STAGE.ACCESS,
            subject: {
                id: item.incoming.id,
                uuid: item.incoming._uuid,
                sourceAssigningAuthority: 'client-a',
                resourceType: item.incoming.resourceType
            },
            operationOutcome: forbiddenOutcome()
        })
    });

/**
 * Shows an entry as its JSON plus its byte offset, which `toJSON` leaves out.
 */
const describeEntry = (entry) => ({ ...entry.toJSON(), sourceByteOffset: entry.sourceByteOffset });

/**
 * Shows the context a pipeline call got.
 */
const describeContext = (context) => ({
    isWriteContext: context instanceof WriteContext,
    hasRequestInfo: context.requestInfo === REQUEST_INFO,
    base_version: context.base_version,
    parsedArgs: context.parsedArgs instanceof ParsedArgs && context.parsedArgs.base_version,
    smartMerge: context.smartMerge
});

/**
 * Returns the owner codes of a body.
 */
const ownerCodesOf = (resource) =>
    resource.meta.security
        .filter((tag) => tag.system === SecurityTagSystem.owner)
        .map((tag) => tag.code);

/**
 * Builds the writer with a fake pipeline that records each call in `calls` and each context it
 * gets in `contexts`, runs `process` on the active items in `processAsync`, as the pipeline's steps
 * get only active items, and returns or throws from
 * `execute` in `executeAsync`. The owner backfill is the real handler, also recorded in `calls`,
 * except that it throws `backfillError` for the resource whose id is `backfillErrorFor`.
 */
const buildWriter = ({ process, execute, backfillErrorFor = null, backfillError = null }) => {
    const calls = [];
    const contexts = [];
    const writePipeline = Object.create(WritePipeline.prototype);
    writePipeline.processAsync = jest.fn(async ({ profile, context, items: allItems }) => {
        const items = allItems.filter((item) => item.isActive);
        contexts.push(context);
        calls.push({
            call: 'processAsync',
            isImportProfile: profile === IMPORT_WRITE_PROFILE,
            items: items.map((item) => ({
                isWriteItem: item instanceof WriteItem,
                index: item.index,
                id: item.incoming.id,
                ownerCodes: ownerCodesOf(item.incoming),
                importLine: item.importLine
            }))
        });
        process(items);
        return { items: allItems };
    });
    writePipeline.executeAsync = jest.fn(async ({ context }) => {
        contexts.push(context);
        calls.push({ call: 'executeAsync' });
        return execute();
    });
    const ownerColumnHandler = new OwnerColumnHandler({ configManager: new ConfigManager() });
    const backfill = ownerColumnHandler.preSaveAsync.bind(ownerColumnHandler);
    jest.spyOn(ownerColumnHandler, 'preSaveAsync').mockImplementation(async (args) => {
        calls.push({ call: 'ownerBackfill', id: args.resource.id, args: Object.keys(args) });
        if (args.resource.id === backfillErrorFor) {
            throw backfillError;
        }
        return await backfill(args);
    });
    const writer = new ImportBatchWriter({
        writePipeline,
        ownerColumnHandler,
        importResponder: new ImportResponder(),
        resourceStructureChecker: new ResourceStructureChecker({
            mergeManager: Object.create(MergeManager.prototype),
            scopesManager: Object.create(ScopesManager.prototype)
        }),
        customTracer: new CustomTracer()
    });
    return { writer, calls, contexts };
};

/**
 * The calls of a batch that reaches the pipeline: one owner backfill per line, then
 * `processAsync` once with the given items, then `executeAsync` once.
 */
const pipelineCalls = (items) => [
    ...items.map(({ id }) => ({ call: 'ownerBackfill', id, args: ['resource'] })),
    { call: 'processAsync', isImportProfile: true, items },
    { call: 'executeAsync' }
];

/**
 * The context every pipeline call of a batch gets.
 */
const BATCH_CONTEXT = Object.freeze({
    isWriteContext: true,
    hasRequestInfo: true,
    base_version: '4_0_0',
    parsedArgs: '4_0_0',
    smartMerge: true
});

/**
 * Shows an item as the fake `processAsync` records it.
 */
const processedItem = (index, uuid, ownerCode, byteOffset) => ({
    isWriteItem: true,
    index,
    id: uuid,
    ownerCodes: [ownerCode],
    importLine: { byteOffset }
});

describe('ImportBatchWriter', () => {
    test.each([
        {
            name: 'two new lines are backfilled, written in one context and returned in order',
            resources: [
                accessOnlyLine({ uuid: UUID_A, byteOffset: 0 }),
                ownedLine({ uuid: UUID_B, byteOffset: 120 })
            ],
            process: queueAll(),
            execute: () => [flushResult(UUID_B), flushResult(UUID_A)],
            expectedCalls: pipelineCalls([
                processedItem(0, UUID_A, 'client-a', 0),
                processedItem(1, UUID_B, 'client-b', 120)
            ]),
            expectedContexts: [BATCH_CONTEXT, BATCH_CONTEXT],
            expectedOutcome: {
                entries: [
                    createdEntry(UUID_A, 0),
                    createdEntry(UUID_B, 120)
                ]
            }
        },
        {
            name: 'a repeat of an earlier line and a stored resource are returned updated',
            resources: [
                ownedLine({ uuid: UUID_A, byteOffset: 0 }),
                ownedLine({ uuid: UUID_A, byteOffset: 250 }),
                accessOnlyLine({ uuid: UUID_B, byteOffset: 500 })
            ],
            process: queueAll((item) => (item.incoming._uuid === UUID_B ? 'update' : 'insert')),
            execute: () => [flushResult(UUID_A), flushResult(UUID_A), flushResult(UUID_B)],
            expectedCalls: pipelineCalls([
                processedItem(0, UUID_A, 'client-b', 0),
                processedItem(1, UUID_A, 'client-b', 250),
                processedItem(2, UUID_B, 'client-a', 500)
            ]),
            expectedContexts: [BATCH_CONTEXT, BATCH_CONTEXT],
            expectedOutcome: {
                entries: [
                    createdEntry(UUID_A, 0),
                    updatedEntry(UUID_A, 250),
                    updatedEntry(UUID_B, 500)
                ]
            }
        },
        {
            name: 'a line the pipeline fails gets its failure entry with its byte offset',
            resources: [
                ownedLine({ uuid: UUID_A, byteOffset: 0 }),
                accessOnlyLine({ uuid: UUID_B, byteOffset: 90 })
            ],
            process: (items) => {
                queueAll()([items[0]]);
                failForbidden(items[1]);
            },
            execute: () => [flushResult(UUID_A)],
            expectedCalls: pipelineCalls([
                processedItem(0, UUID_A, 'client-b', 0),
                processedItem(1, UUID_B, 'client-a', 90)
            ]),
            expectedContexts: [BATCH_CONTEXT, BATCH_CONTEXT],
            expectedOutcome: {
                entries: [
                    createdEntry(UUID_A, 0),
                    {
                        operationOutcome: {
                            resourceType: 'OperationOutcome',
                            issue: [forbiddenIssue(90)]
                        },
                        issue: forbiddenIssue(90),
                        created: false,
                        id: UUID_B,
                        uuid: UUID_B,
                        resourceType: 'Patient',
                        updated: false,
                        sourceAssigningAuthority: 'client-a',
                        sourceByteOffset: 90
                    }
                ]
            }
        },
        {
            name: 'a throw from the flush rejects with its message and returns no entries',
            resources: [
                ownedLine({ uuid: UUID_A, byteOffset: 0 }),
                accessOnlyLine({ uuid: UUID_B, byteOffset: 75 })
            ],
            process: queueAll(),
            execute: () => {
                throw new Error('synthetic flush failure');
            },
            expectedCalls: pipelineCalls([
                processedItem(0, UUID_A, 'client-b', 0),
                processedItem(1, UUID_B, 'client-a', 75)
            ]),
            expectedContexts: [BATCH_CONTEXT, BATCH_CONTEXT],
            expectedOutcome: { error: 'synthetic flush failure' }
        },
        {
            name: 'an empty batch writes nothing and returns no entries',
            resources: [],
            process: queueAll(),
            execute: () => [],
            expectedCalls: [],
            expectedContexts: [],
            expectedOutcome: { entries: [] }
        }
    ])('$name', async ({ resources, process, execute, ...expected }) => {
        const { writer, calls, contexts } = buildWriter({ process, execute });

        const outcome = await writer.writeBatchAsync({ requestInfo: REQUEST_INFO, resources }).then(
            (entries) => ({ entries: entries.map(describeEntry) }),
            (error) => ({ error: error.message })
        );

        expect(outcome).toStrictEqual(expected.expectedOutcome);
        expect(calls).toStrictEqual(expected.expectedCalls);
        expect(contexts.map(describeContext)).toStrictEqual(expected.expectedContexts);
        expect(new Set(contexts).size).toBe(Math.min(contexts.length, 1));
    });

    test.each([
        {
            name: 'a line failing a check and a queued line give a failed and a created entry',
            resources: [
                accessOnlyLine({ uuid: UUID_B, byteOffset: 0 }),
                ownedLine({ uuid: UUID_A, byteOffset: 90 })
            ],
            process: (items) => {
                failForbidden(items[0]);
                queueAll()([items[1]]);
            },
            expectedEntries: [
                { resourceType: 'Patient', uuid: UUID_B, outcome: 'failed', sourceByteOffset: 0 },
                { resourceType: 'Patient', uuid: UUID_A, outcome: 'created', sourceByteOffset: 90 }
            ],
            expectedResourceTypeCount: 1
        },
        {
            name: 'queued lines of two resource types count two types',
            resources: [
                ownedLine({ uuid: UUID_A, byteOffset: 0 }),
                ownedLine({ uuid: UUID_B, byteOffset: 50, resourceType: 'Observation' })
            ],
            process: queueAll(),
            expectedEntries: [
                { resourceType: 'Patient', uuid: UUID_A, outcome: 'created', sourceByteOffset: 0 },
                {
                    resourceType: 'Observation',
                    uuid: UUID_B,
                    outcome: 'created',
                    sourceByteOffset: 50
                }
            ],
            expectedResourceTypeCount: 2
        },
        {
            name: 'a failed line of another resource type is not counted, as it queued no write',
            resources: [
                ownedLine({ uuid: UUID_B, byteOffset: 0, resourceType: 'Observation' }),
                ownedLine({ uuid: UUID_A, byteOffset: 70 })
            ],
            process: (items) => {
                failForbidden(items[0]);
                queueAll()([items[1]]);
            },
            expectedEntries: [
                {
                    resourceType: 'Observation',
                    uuid: UUID_B,
                    outcome: 'failed',
                    sourceByteOffset: 0
                },
                { resourceType: 'Patient', uuid: UUID_A, outcome: 'created', sourceByteOffset: 70 }
            ],
            expectedResourceTypeCount: 1
        }
    ])(
        'a throw from the flush rejects with an ImportBatchFlushError: $name',
        async ({ resources, process, expectedEntries, expectedResourceTypeCount }) => {
            const flushError = new Error('synthetic flush failure');
            const { writer } = buildWriter({
                process,
                execute: () => {
                    throw flushError;
                }
            });

            const error = await writer
                .writeBatchAsync({ requestInfo: REQUEST_INFO, resources })
                .catch((rejection) => rejection);

            expect(error).toBeInstanceOf(ImportBatchFlushError);
            expect({
                name: error.name,
                message: error.message,
                causeIsTheFlushError: error.cause === flushError,
                resourceTypeCount: error.resourceTypeCount,
                entries: error.entries.map((entry) => ({
                    resourceType: entry.resourceType,
                    uuid: entry._uuid,
                    outcome: entry.issue ? 'failed' : entry.created ? 'created' : 'other',
                    sourceByteOffset: entry.sourceByteOffset
                }))
            }).toStrictEqual({
                name: 'ImportBatchFlushError',
                message: 'synthetic flush failure',
                causeIsTheFlushError: true,
                resourceTypeCount: expectedResourceTypeCount,
                entries: expectedEntries
            });
        }
    );

    test.each([
        { name: 'an invalid versionId', versionId: 'not a valid id!' },
        { name: 'a valid versionId', versionId: '7' },
        { name: 'no versionId', versionId: undefined }
    ])('$name is dropped from the body before the pipeline sees it', async ({ versionId }) => {
        const seenVersionIds = [];
        const { writer } = buildWriter({
            process: (items) => {
                seenVersionIds.push(...items.map((item) => item.incoming.meta.versionId));
            },
            execute: () => []
        });
        const line = ownedLine({ uuid: UUID_A, byteOffset: 0 });
        line.fhirResource.meta.versionId = versionId;

        await writer.writeBatchAsync({ requestInfo: REQUEST_INFO, resources: [line] });

        expect(seenVersionIds).toStrictEqual([undefined]);
    });

    test('a line with a structural error fails before the pipeline and the other lines are written', async () => {
        const { writer, calls } = buildWriter({
            process: queueAll(),
            execute: () => [flushResult(UUID_A)]
        });
        const missingId = ownedLine({ uuid: UUID_B, byteOffset: 40 });
        delete missingId.fhirResource.id;
        const unsupportedType = ownedLine({ uuid: UUID_B, byteOffset: 80 });
        unsupportedType.fhirResource.resourceType = 'Parameters';

        const entries = await writer.writeBatchAsync({
            requestInfo: REQUEST_INFO,
            resources: [ownedLine({ uuid: UUID_A, byteOffset: 0 }), missingId, unsupportedType]
        });

        expect(calls.filter(({ call }) => call !== 'ownerBackfill')).toStrictEqual([
            {
                call: 'processAsync',
                isImportProfile: true,
                items: [processedItem(0, UUID_A, 'client-b', 0)]
            },
            { call: 'executeAsync' }
        ]);
        const describeFailure = ({ issue, ...entry }) => ({
            id: entry.id,
            uuid: entry.uuid,
            resourceType: entry.resourceType,
            created: entry.created,
            updated: entry.updated,
            issue: issue && {
                code: issue.code,
                diagnostics: issue.diagnostics,
                expression: issue.expression,
                extension: issue.extension
            },
            sourceByteOffset: entry.sourceByteOffset
        });
        expect(entries.map(describeEntry).map(describeFailure)).toStrictEqual([
            { ...createdEntry(UUID_A, 0), issue: undefined },
            {
                id: undefined,
                uuid: UUID_B,
                resourceType: 'Patient',
                created: false,
                updated: false,
                issue: {
                    code: 'exception',
                    diagnostics: 'resource is missing id',
                    expression: ['Patient'],
                    extension: byteOffsetExtension(40)
                },
                sourceByteOffset: 40
            },
            {
                id: UUID_B,
                uuid: UUID_B,
                resourceType: 'Parameters',
                created: false,
                updated: false,
                issue: {
                    code: 'exception',
                    diagnostics: 'resourceType is not supported',
                    expression: [`Parameters/${UUID_B}`],
                    extension: byteOffsetExtension(80)
                },
                sourceByteOffset: 80
            }
        ]);
        expect(entries[1].operationOutcome.issue[0].details.text).toBe(
            'Error merging: ' + JSON.stringify(missingId.fhirResource)
        );
    });

    test('a line whose owner backfill throws fails alone at the identity stage and the other lines are written', async () => {
        const backfillError = new Error('synthetic owner backfill failure');
        const { writer, calls } = buildWriter({
            process: queueAll(),
            execute: () => [flushResult(UUID_A), flushResult(UUID_C)],
            backfillErrorFor: UUID_B,
            backfillError
        });
        jest.spyOn(writer.importResponder, 'toFailureEntry');

        const entries = await writer.writeBatchAsync({
            requestInfo: REQUEST_INFO,
            resources: [
                ownedLine({ uuid: UUID_A, byteOffset: 0 }),
                accessOnlyLine({ uuid: UUID_B, byteOffset: 60 }),
                accessOnlyLine({ uuid: UUID_C, byteOffset: 130 })
            ]
        });

        expect(calls).toStrictEqual([
            { call: 'ownerBackfill', id: UUID_A, args: ['resource'] },
            { call: 'ownerBackfill', id: UUID_B, args: ['resource'] },
            { call: 'ownerBackfill', id: UUID_C, args: ['resource'] },
            {
                call: 'processAsync',
                isImportProfile: true,
                items: [
                    processedItem(0, UUID_A, 'client-b', 0),
                    processedItem(2, UUID_C, 'client-a', 130)
                ]
            },
            { call: 'executeAsync' }
        ]);
        const failedItem = writer.importResponder.toFailureEntry.mock.calls[0][0];
        expect({
            index: failedItem.index,
            stage: failedItem.failure.stage,
            subject: failedItem.failure.subject,
            error: failedItem.failure.error
        }).toStrictEqual({
            index: 1,
            stage: WRITE_FAILURE_STAGE.IDENTITY,
            subject: { id: UUID_B, uuid: UUID_B, sourceAssigningAuthority: undefined, resourceType: 'Patient' },
            error: backfillError
        });
        const failureIssue = {
            extension: byteOffsetExtension(60),
            severity: 'error',
            code: 'exception',
            details: { text: 'synthetic owner backfill failure' },
            diagnostics: 'synthetic owner backfill failure',
            expression: ['Patient']
        };
        expect(entries.map(describeEntry)).toStrictEqual([
            createdEntry(UUID_A, 0),
            {
                operationOutcome: { resourceType: 'OperationOutcome', issue: [failureIssue] },
                issue: failureIssue,
                created: false,
                id: UUID_B,
                uuid: UUID_B,
                resourceType: 'Patient',
                updated: false,
                sourceByteOffset: 60
            },
            createdEntry(UUID_C, 130)
        ]);
    });
});
