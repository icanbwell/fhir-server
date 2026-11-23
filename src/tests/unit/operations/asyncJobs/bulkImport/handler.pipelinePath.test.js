'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestGlobal.fn(),
    logError: jestGlobal.fn(),
    logDebug: jestGlobal.fn(),
    logWarn: jestGlobal.fn()
}));

jestGlobal.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: () => {},
    assertIsValid: () => {},
    assertFail: () => {}
}));

jestGlobal.mock('@aws-sdk/client-s3', () => ({
    S3Client: jestGlobal.fn().mockImplementation(() => ({ send: jestGlobal.fn() })),
    HeadObjectCommand: jestGlobal.fn().mockImplementation((params) => params)
}));

jestGlobal.mock('../../../../../utils/metrics', () => ({
    ...jestGlobal.requireActual('../../../../../utils/metrics'),
    recordImportRanges: jestGlobal.fn(),
    recordImportResourceOutcomes: jestGlobal.fn()
}));

const { BulkImportHandler } = require('../../../../../operations/asyncJobs/bulkImport/handler');
const {
    WritePipelineSwitch
} = require('../../../../../operations/writePipeline/writePipelineSwitch');
const { FhirRequestInfo } = require('../../../../../utils/fhirRequestInfo');
const { MergeResultEntry } = require('../../../../../operations/common/mergeResultEntry');
const { SecurityTagSystem } = require('../../../../../utils/securityTagSystem');
const { logInfo, logError } = require('../../../../../operations/common/logging');
const metrics = require('../../../../../utils/metrics');
const BaseSerializer = require('../../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });

/**
 * Builds an async generator over pre-canned NDJSON read results, optionally throwing after them.
 * @param {Array<Object>} lines
 * @param {Error|null} [errorAfterLines]
 */
function ndjsonLines(lines, errorAfterLines = null) {
    return async function* () {
        for (const line of lines) {
            yield line;
        }
        if (errorAfterLines) {
            throw errorAfterLines;
        }
    };
}

/**
 * Builds one reader result for a resource line or a parse error.
 */
function makeLine({ lineNumber = 1, byteOffset = 0, resource = null, parseError = null } = {}) {
    return { lineNumber, byteOffset, resource, parseError };
}

/**
 * Builds a synthetic Patient owned by `client-a`.
 * @param {string} id
 */
function makePatient(id) {
    return {
        resourceType: 'Patient',
        id,
        meta: { security: [{ system: SecurityTagSystem.owner, code: 'client-a' }] }
    };
}

/**
 * Builds an ifNoneExist wrapper line around a synthetic Patient.
 * @param {string} id
 * @param {string} ifNoneExist
 */
function makeWrappedPatient(id, ifNoneExist) {
    return { ifNoneExist, resource: makePatient(id) };
}

/**
 * Builds the entry the import batch writer returns for one buffered line. A `failedWithoutIssue`
 * entry has an OperationOutcome with no issue, so its `issue` is null.
 * @param {{fhirResource: Object, byteOffset: number}} resource
 * @param {'created'|'updated'|'unchanged'|'failed'|'failedWithoutIssue'} outcome
 * @returns {MergeResultEntry}
 */
function entryFor({ fhirResource, byteOffset }, outcome) {
    if (outcome === 'failedWithoutIssue') {
        return new MergeResultEntry({
            id: fhirResource.id,
            uuid: fhirResource._uuid,
            sourceAssigningAuthority: fhirResource._sourceAssigningAuthority,
            resourceType: fhirResource.resourceType,
            created: false,
            updated: false,
            issue: null,
            operationOutcome: { resourceType: 'OperationOutcome', issue: [] }
        }).withSourceByteOffset(byteOffset);
    }
    const failed = outcome === 'failed';
    return new MergeResultEntry({
        id: fhirResource.id,
        uuid: fhirResource._uuid,
        sourceAssigningAuthority: fhirResource._sourceAssigningAuthority,
        resourceType: fhirResource.resourceType,
        created: outcome === 'created',
        updated: outcome === 'updated',
        issue: failed ? { severity: 'error', code: 'forbidden' } : null,
        operationOutcome: failed
            ? {
                  resourceType: 'OperationOutcome',
                  issue: [{ severity: 'error', code: 'forbidden' }]
              }
            : null
    }).withSourceByteOffset(byteOffset);
}

/**
 * Returns a writer implementation that answers each buffered line with the outcome its id names.
 * @param {Object<string, string>} outcomeById
 */
function writerAnswering(outcomeById) {
    return async ({ resources }) =>
        resources.map((resource) =>
            entryFor(resource, outcomeById[resource.fhirResource.id] ?? 'created')
        );
}

describe('BulkImportHandler, write pipeline path', () => {
    let deps;
    let queuedTasks;
    let writePipelineOperations;

    beforeEach(() => {
        jestGlobal.clearAllMocks();
        queuedTasks = [];
        writePipelineOperations = ['import'];

        const configValues = {
            bulkImportAllowedS3Buckets: ['allowed-bucket'],
            awsRegion: 'us-east-1',
            bulkImportBatchSize: 2,
            bulkImportBatchDelayMs: 0
        };
        const configManager = {};
        for (const [key, value] of Object.entries(configValues)) {
            Object.defineProperty(configManager, key, { get: () => value, configurable: true });
        }
        Object.defineProperty(configManager, 'writePipelineOperations', {
            get: () => writePipelineOperations,
            configurable: true
        });

        deps = {
            configManager,
            kafkaClientV2: {},
            bulkImportEventProducer: {
                publishImportEventsAsync: jestGlobal.fn().mockResolvedValue(1),
                publishRangeProgressEventAsync: jestGlobal.fn().mockResolvedValue(undefined)
            },
            bulkImportTaskStateMachine: {
                loadTaskAsync: jestGlobal
                    .fn()
                    .mockResolvedValue({ id: 'task-1', status: 'requested' }),
                isRangeRecorded: jestGlobal.fn().mockReturnValue(false)
            },
            databaseQueryFactory: {
                createQuery: jestGlobal.fn(() => ({
                    fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
                }))
            },
            fastDatabaseBulkInserter: {
                executeAsync: jestGlobal.fn().mockResolvedValue(undefined)
            },
            s3NdjsonReader: {
                readNdjsonAsync: jestGlobal.fn(ndjsonLines([])),
                writeNdjsonAsync: jestGlobal.fn().mockResolvedValue(undefined),
                parseS3Uri: jestGlobal.fn((uri) => {
                    const m = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
                    return { bucket: m[1], key: m[2] };
                })
            },
            postRequestProcessor: {
                add: jestGlobal.fn(({ fnTask }) => queuedTasks.push(fnTask)),
                executeAsync: jestGlobal.fn(async () => {
                    const tasks = queuedTasks.splice(0, queuedTasks.length);
                    for (const t of tasks) {
                        await t();
                    }
                })
            },
            requestSpecificCache: {
                clearAsync: jestGlobal.fn().mockResolvedValue(undefined)
            },
            auditLogger: {
                logAuditEntryAsync: jestGlobal.fn().mockResolvedValue(undefined),
                logErrorAuditEntryAsync: jestGlobal.fn().mockResolvedValue(undefined),
                flushAsync: jestGlobal.fn().mockResolvedValue(undefined)
            },
            r4ArgsParser: {
                parseArgs: jestGlobal.fn(({ resourceType, args }) => ({ resourceType, ...args }))
            },
            searchQueryBuilder: {
                buildSearchQueryBasedOnVersion: jestGlobal.fn(({ parsedArgs }) => ({
                    query: { identifier: parsedArgs.identifier }
                }))
            },
            mergeManager: {
                mergeResourceAsync: jestGlobal.fn().mockResolvedValue(null),
                preMergeChecksMultipleAsync: jestGlobal
                    .fn()
                    .mockResolvedValue({ mergePreCheckErrors: [], validResources: [] })
            },
            databaseBulkLoader: {
                loadResourcesAsync: jestGlobal.fn().mockResolvedValue(undefined),
                getResourceFromExistingList: jestGlobal.fn(() => null)
            },
            sourceAssigningAuthorityColumnHandler: {
                preSaveAsync: jestGlobal.fn(async ({ resource }) => {
                    resource._sourceAssigningAuthority = resource.meta?.security?.find(
                        (t) => t.system === SecurityTagSystem.owner
                    )?.code;
                    return resource;
                })
            },
            uuidColumnHandler: {
                preSaveAsync: jestGlobal.fn(async ({ resource }) => {
                    resource._uuid = `uuid-of-${resource.id}`;
                    return resource;
                })
            },
            writeAllowedByScopesValidator: {
                validate: jestGlobal
                    .fn()
                    .mockResolvedValue({ preCheckErrors: [], validatedObjects: [] })
            },
            resourceValidator: {
                validateResourceMetaSync: jestGlobal.fn(() => null)
            },
            ownerColumnHandler: {
                preSaveAsync: jestGlobal.fn(async ({ resource }) => resource)
            },
            writePipelineSwitch: new WritePipelineSwitch({ configManager }),
            importBatchWriter: {
                writeBatchAsync: jestGlobal.fn(writerAnswering({}))
            }
        };
    });

    /**
     * Builds an ImportRangeRequested message for one range of a synthetic file.
     */
    function rangeMessage() {
        return {
            key: 'task-1',
            value: JSON.stringify({
                specversion: '1.0',
                id: 'evt-1',
                source: 'https://www.icanbwell.com/fhir-server',
                type: 'ImportRangeRequested',
                datacontenttype: 'application/json',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://allowed-bucket/run/Patient.ndjson',
                    byteRangeStart: 0,
                    byteRangeEnd: 999,
                    rangeIndex: 0,
                    totalRanges: 1,
                    taskTotalRanges: 1,
                    fileSize: 1000,
                    user: 'practitioner/synthetic-user',
                    scope: 'user/*.write',
                    alternateUserId: 'alt-1',
                    isUser: true,
                    remoteIpAddress: '10.0.0.1'
                }
            }),
            headers: []
        };
    }

    /**
     * Runs one range through a handler built from the current fakes.
     */
    async function runRangeAsync() {
        const handler = new BulkImportHandler(deps);
        await handler.handleImportRangeRequestedAsync(rangeMessage());
    }

    /**
     * Returns the entries written to the range's result NDJSON.
     */
    function writtenResultEntries() {
        const resultWrite = deps.s3NdjsonReader.writeNdjsonAsync.mock.calls.find(
            ([{ filepath }]) => !filepath.includes('/errors/')
        );
        return resultWrite[0].data
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
    }

    /**
     * Returns the counters the range logged when it completed.
     */
    function loggedCounters() {
        const [, { created, updated, failed, skipped }] = logInfo.mock.calls.find(
            ([message]) => message === 'Bulk import range processed'
        );
        return { created, updated, failed, skipped };
    }

    /**
     * Returns the ids of the lines each writer call received.
     */
    function writerCallIds() {
        return deps.importBatchWriter.writeBatchAsync.mock.calls.map(([{ resources }]) =>
            resources.map(({ fhirResource }) => fhirResource.id)
        );
    }

    /**
     * Returns the progress event types the range published.
     */
    function publishedTypes() {
        return deps.bulkImportEventProducer.publishRangeProgressEventAsync.mock.calls.map(
            ([e]) => e.type
        );
    }

    test('switch on: a flush goes to the writer, not the old preload, merge or flush', async () => {
        deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(
            ndjsonLines([
                makeLine({ lineNumber: 1, byteOffset: 0, resource: makePatient('dup') }),
                makeLine({ lineNumber: 2, byteOffset: 10, resource: makePatient('dup') }),
                makeLine({ lineNumber: 3, byteOffset: 20, resource: makePatient('other') })
            ])
        );

        await runRangeAsync();

        const calls = deps.importBatchWriter.writeBatchAsync.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0][0].requestInfo).toBeInstanceOf(FhirRequestInfo);
        expect(calls[1][0].requestInfo).toBe(calls[0][0].requestInfo);
        expect(
            calls.map(([{ resources }]) =>
                resources.map(({ fhirResource, byteOffset, forceUpdated }) => ({
                    uuid: fhirResource._uuid,
                    byteOffset,
                    forceUpdated
                }))
            )
        ).toEqual([
            [
                { uuid: 'uuid-of-dup', byteOffset: 0, forceUpdated: false },
                { uuid: 'uuid-of-dup', byteOffset: 10, forceUpdated: true }
            ],
            [{ uuid: 'uuid-of-other', byteOffset: 20, forceUpdated: false }]
        ]);
        expect(deps.mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
        expect(deps.mergeManager.preMergeChecksMultipleAsync).not.toHaveBeenCalled();
        expect(deps.writeAllowedByScopesValidator.validate).not.toHaveBeenCalled();
        expect(deps.ownerColumnHandler.preSaveAsync).not.toHaveBeenCalled();
        expect(deps.databaseBulkLoader.loadResourcesAsync).not.toHaveBeenCalled();
        expect(deps.fastDatabaseBulkInserter.executeAsync).not.toHaveBeenCalled();
        expect(publishedTypes()).toEqual(['ImportRangeStarted', 'ImportRangeCompleted']);
        expect(deps.postRequestProcessor.executeAsync).toHaveBeenCalledTimes(1);
        expect(deps.auditLogger.flushAsync).toHaveBeenCalledTimes(1);
        expect(deps.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
    });

    test.each([
        {
            name: 'the switch lists other operations only',
            arrange: () => {
                writePipelineOperations = ['merge'];
            }
        },
        {
            name: 'no switch is given',
            arrange: () => {
                delete deps.writePipelineSwitch;
            }
        },
        {
            name: 'no writer is given',
            arrange: () => {
                delete deps.importBatchWriter;
            }
        }
    ])('the old merge runs and the writer is never called when $name', async ({ arrange }) => {
        const writeBatchAsync = deps.importBatchWriter.writeBatchAsync;
        arrange();
        deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(
            ndjsonLines([makeLine({ lineNumber: 1, byteOffset: 0, resource: makePatient('p1') })])
        );

        await runRangeAsync();

        expect(writeBatchAsync).not.toHaveBeenCalled();
        expect(deps.databaseBulkLoader.loadResourcesAsync).toHaveBeenCalledTimes(1);
        expect(deps.mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
        expect(deps.fastDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);
        expect(loggedCounters()).toEqual({ created: 1, updated: 0, failed: 0, skipped: 0 });
    });

    test.each([
        {
            outcome: 'created',
            counters: { created: 1, updated: 0, failed: 0, skipped: 0 },
            audits: ['create'],
            errorAudits: 0,
            loggedIssueCodes: []
        },
        {
            outcome: 'updated',
            counters: { created: 0, updated: 1, failed: 0, skipped: 0 },
            audits: ['update'],
            errorAudits: 0,
            loggedIssueCodes: []
        },
        {
            outcome: 'unchanged',
            counters: { created: 0, updated: 0, failed: 0, skipped: 1 },
            audits: [],
            errorAudits: 0,
            loggedIssueCodes: []
        },
        {
            outcome: 'failed',
            counters: { created: 0, updated: 0, failed: 1, skipped: 0 },
            audits: [],
            errorAudits: 1,
            loggedIssueCodes: ['forbidden']
        },
        {
            outcome: 'failedWithoutIssue',
            counters: { created: 0, updated: 0, failed: 1, skipped: 0 },
            audits: [],
            errorAudits: 0,
            loggedIssueCodes: [undefined]
        }
    ])(
        'a $outcome entry from the writer sets the counters, the result line and the audits',
        async ({ outcome, counters, audits, errorAudits, loggedIssueCodes }) => {
            deps.importBatchWriter.writeBatchAsync.mockImplementation(
                writerAnswering({ p1: outcome })
            );
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(
                ndjsonLines([
                    makeLine({ lineNumber: 1, byteOffset: 30, resource: makePatient('p1') })
                ])
            );

            await runRangeAsync();

            const expectedEntry = entryFor(
                {
                    fhirResource: {
                        resourceType: 'Patient',
                        id: 'p1',
                        _uuid: 'uuid-of-p1',
                        _sourceAssigningAuthority: 'client-a'
                    },
                    byteOffset: 30
                },
                outcome
            );
            expect(loggedCounters()).toEqual(counters);
            expect(writtenResultEntries()).toEqual([JSON.parse(JSON.stringify(expectedEntry))]);
            expect(metrics.recordImportResourceOutcomes).toHaveBeenCalledWith([expectedEntry]);
            expect(
                deps.auditLogger.logAuditEntryAsync.mock.calls.map(([{ operation }]) => operation)
            ).toEqual(audits);
            expect(deps.auditLogger.logErrorAuditEntryAsync).toHaveBeenCalledTimes(errorAudits);
            expect(
                logError.mock.calls.filter(
                    ([message]) => message === 'Failed to merge bulk import resource'
                )
            ).toEqual(
                loggedIssueCodes.map((issueCode) => [
                    'Failed to merge bulk import resource',
                    {
                        taskId: 'task-1',
                        filepath: 's3://allowed-bucket/run/Patient.ndjson',
                        resourceType: 'Patient',
                        byteOffset: 30,
                        issueCode
                    }
                ])
            );
        }
    );

    test('a failed line releases its ifNoneExist key and a written line keeps it', async () => {
        deps.importBatchWriter.writeBatchAsync.mockImplementation(
            writerAnswering({ a1: 'failed' })
        );
        deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(
            ndjsonLines([
                makeLine({
                    lineNumber: 1,
                    byteOffset: 0,
                    resource: makeWrappedPatient('a1', 'identifier=sys%7Ca')
                }),
                makeLine({
                    lineNumber: 2,
                    byteOffset: 10,
                    resource: makeWrappedPatient('b1', 'identifier=sys%7Cb')
                }),
                makeLine({
                    lineNumber: 3,
                    byteOffset: 20,
                    resource: makeWrappedPatient('a2', 'identifier=sys%7Ca')
                }),
                makeLine({
                    lineNumber: 4,
                    byteOffset: 30,
                    resource: makeWrappedPatient('b2', 'identifier=sys%7Cb')
                })
            ])
        );

        await runRangeAsync();

        expect(writerCallIds()).toEqual([['a1', 'b1'], ['a2']]);
        expect(loggedCounters()).toEqual({ created: 2, updated: 0, failed: 1, skipped: 1 });
        expect(
            writtenResultEntries().map(({ id, created, updated }) => ({ id, created, updated }))
        ).toEqual([
            { id: 'a1', created: false, updated: false },
            { id: 'b1', created: true, updated: false },
            { id: 'a2', created: true, updated: false },
            { id: 'b2', created: false, updated: false }
        ]);
    });

    test.each([
        {
            name: 'on the first flush, the range is read again up to three times and fails',
            failingCall: 1,
            readAttempts: 3,
            writerCalls: 3,
            auditedCreates: []
        },
        {
            name: 'after an earlier flush wrote, the range is not read again and fails',
            failingCall: 2,
            readAttempts: 1,
            writerCalls: 2,
            auditedCreates: [['uuid-of-p1', 'uuid-of-p2']]
        }
    ])(
        'when the writer throws $name, with nothing of that batch counted',
        async ({ failingCall, readAttempts, writerCalls, auditedCreates }) => {
            let call = 0;
            deps.importBatchWriter.writeBatchAsync.mockImplementation(async (args) => {
                call++;
                if (call >= failingCall) {
                    throw new Error('bulk write failed');
                }
                return writerAnswering({})(args);
            });
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(
                ndjsonLines([
                    makeLine({ lineNumber: 1, byteOffset: 0, resource: makePatient('p1') }),
                    makeLine({ lineNumber: 2, byteOffset: 10, resource: makePatient('p2') }),
                    makeLine({ lineNumber: 3, byteOffset: 20, resource: makePatient('p3') })
                ])
            );

            await runRangeAsync();

            expect(deps.s3NdjsonReader.readNdjsonAsync).toHaveBeenCalledTimes(readAttempts);
            expect(deps.importBatchWriter.writeBatchAsync).toHaveBeenCalledTimes(writerCalls);
            expect(publishedTypes()).toEqual(['ImportRangeStarted', 'ImportRangeFailed']);
            expect(
                deps.bulkImportEventProducer.publishRangeProgressEventAsync.mock.calls[1][0].data
                    .errorMessage
            ).toBe('bulk write failed');
            expect(deps.s3NdjsonReader.writeNdjsonAsync).not.toHaveBeenCalled();
            const [recordedEntries] = metrics.recordImportResourceOutcomes.mock.calls[0];
            expect(recordedEntries.map(({ id }) => id)).toEqual(
                auditedCreates.length > 0 ? ['p1', 'p2'] : []
            );
            expect(deps.auditLogger.logAuditEntryAsync.mock.calls.map(([{ ids }]) => ids)).toEqual(
                auditedCreates
            );
            expect(deps.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(readAttempts);
        }
    );

    test('a flush of no buffered line resets the batch, so no extra flush follows', async () => {
        deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(
            ndjsonLines([
                makeLine({
                    lineNumber: 1,
                    byteOffset: 0,
                    parseError: new Error('Unexpected token')
                }),
                makeLine({
                    lineNumber: 2,
                    byteOffset: 10,
                    parseError: new Error('Unexpected token')
                })
            ])
        );

        await runRangeAsync();

        expect(writerCallIds()).toEqual([[]]);
        expect(loggedCounters()).toEqual({ created: 0, updated: 0, failed: 2, skipped: 0 });
        expect(publishedTypes()).toEqual(['ImportRangeStarted', 'ImportRangeCompleted']);
    });

    test('a read error after a flush of no buffered line fails the range unretried', async () => {
        deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(
            ndjsonLines(
                [
                    makeLine({
                        lineNumber: 1,
                        byteOffset: 0,
                        parseError: new Error('Unexpected token')
                    }),
                    makeLine({
                        lineNumber: 2,
                        byteOffset: 10,
                        parseError: new Error('Unexpected token')
                    })
                ],
                new Error('S3 stream aborted')
            )
        );

        await runRangeAsync();

        expect(deps.s3NdjsonReader.readNdjsonAsync).toHaveBeenCalledTimes(1);
        expect(writerCallIds()).toEqual([[]]);
        expect(publishedTypes()).toEqual(['ImportRangeStarted', 'ImportRangeFailed']);
    });
});
