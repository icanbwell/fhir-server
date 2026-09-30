'use strict';

/**
 * Unit tests for BulkImportHandler's WORKER path (ImportRangeRequested) plus the shared
 * helpers the orchestrator suite (handlerOrchestrator.test.js) does not cover.
 *
 * Focus areas:
 * - partial-batch failure handling and retry legality (retry only when nothing has flushed)
 * - whether a failed range is reported as a completed one
 * - whether security tags (owner / access / sourceAssigningAuthority) survive ingest, and whether
 *   the ifNoneExist existence check can act as a cross-tenant oracle
 * - scope enforcement before mergeManager is reached
 *
 * Tests that assert CORRECT behavior the current code does NOT implement FAIL by design and
 * are the bug report.
 */

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

const mockS3Send = jestGlobal.fn();
jestGlobal.mock('@aws-sdk/client-s3', () => ({
    S3Client: jestGlobal.fn().mockImplementation(() => ({ send: mockS3Send })),
    HeadObjectCommand: jestGlobal.fn().mockImplementation((params) => params)
}));

const { BulkImportHandler } = require('../../../../../operations/asyncJobs/bulkImport/handler');
const { FhirRequestInfo } = require('../../../../../utils/fhirRequestInfo');
const { MergeResultEntry } = require('../../../../../operations/common/mergeResultEntry');
const { SecurityTagSystem } = require('../../../../../utils/securityTagSystem');
const {
    BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY,
    STRICT_SEARCH_HANDLING
} = require('../../../../../constants');
const { logError } = require('../../../../../operations/common/logging');
const BaseSerializer = require('../../../../../fhir/writeSerializers/4_0_0/customSerializers/baseSerializer');

// Mirrors createContainer.js:191 — every write serializer reads BaseSerializer.configManager,
// which is a process-wide static wired at container bootstrap. Without it the real
// FhirResourceWriteSerializer.serialize() the handler calls throws on any coded element.
BaseSerializer.setConfigManager({ preSaveCodingIdUpdateResources: [] });

/**
 * Builds an async generator over pre-canned NDJSON read results.
 * @param {Array<Object>} lines
 */
function ndjsonLines (lines) {
    return async function * () {
        for (const line of lines) {
            yield line;
        }
    };
}

function makeLine ({ lineNumber = 1, byteOffset = 0, resource = null, parseError = null } = {}) {
    return { lineNumber, byteOffset, resource, parseError };
}

function makePatient ({ id = 'patient-1', owner, access, sourceAssigningAuthority } = {}) {
    const patient = { resourceType: 'Patient', id };
    const security = [];
    if (owner) {
        security.push({ system: SecurityTagSystem.owner, code: owner });
    }
    if (access) {
        security.push({ system: SecurityTagSystem.access, code: access });
    }
    if (sourceAssigningAuthority) {
        security.push({ system: SecurityTagSystem.sourceAssigningAuthority, code: sourceAssigningAuthority });
    }
    if (security.length > 0) {
        patient.meta = { security };
    }
    return patient;
}

describe('BulkImportHandler — worker path', () => {
    let deps;
    let handler;
    let queuedTasks;

    beforeEach(() => {
        jestGlobal.clearAllMocks();
        mockS3Send.mockReset();
        queuedTasks = [];

        const configValues = {
            bulkImportAllowedS3Buckets: ['allowed-bucket'],
            awsRegion: 'us-east-1',
            bulkImportMinFileSizeMb: 0,
            bulkImportMaxFileSizeGb: 5,
            bulkImportBatchSize: 2,
            bulkImportBatchDelayMs: 0
        };
        const configManager = {};
        for (const [key, value] of Object.entries(configValues)) {
            Object.defineProperty(configManager, key, { get: () => value, configurable: true });
        }

        deps = {
            configManager,
            kafkaClientV2: {},
            bulkImportEventProducer: {
                publishImportEventsAsync: jestGlobal.fn().mockResolvedValue(1),
                publishRangeProgressEventAsync: jestGlobal.fn().mockResolvedValue(undefined)
            },
            bulkImportTaskStateMachine: {
                loadTaskAsync: jestGlobal.fn().mockResolvedValue({ id: 'task-1', status: 'requested' }),
                handleRangeStartedAsync: jestGlobal.fn().mockResolvedValue(undefined),
                handleRangeCompletedAsync: jestGlobal.fn().mockResolvedValue(undefined),
                handleRangeFailedAsync: jestGlobal.fn().mockResolvedValue(undefined),
                updateTaskStatusAsync: jestGlobal.fn().mockResolvedValue(undefined)
            },
            databaseQueryFactory: {
                createQuery: jestGlobal.fn(() => ({
                    findOneAsync: jestGlobal.fn().mockResolvedValue(null)
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
            // real stateful queue (RULE 9): executeAsync actually runs what was queued
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
                mergeResourceAsync: jestGlobal.fn().mockResolvedValue(null)
            },
            databaseBulkLoader: {
                loadResourcesAsync: jestGlobal.fn().mockResolvedValue(undefined),
                getResourceFromExistingList: jestGlobal.fn(() => null)
            },
            sourceAssigningAuthorityColumnHandler: {
                preSaveAsync: jestGlobal.fn(async ({ resource }) => {
                    resource._sourceAssigningAuthority =
                        resource.meta?.security?.find((t) => t.system === SecurityTagSystem.sourceAssigningAuthority)?.code ||
                        resource.meta?.security?.find((t) => t.system === SecurityTagSystem.owner)?.code;
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
                validate: jestGlobal.fn().mockResolvedValue({ preCheckErrors: [], validatedObjects: [] })
            }
        };

        handler = new BulkImportHandler(deps);
    });

    /**
     * @param {Object} [overrides]
     */
    function rangeMessage (overrides = {}) {
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
                    user: 'practitioner/dr-smith',
                    scope: 'user/*.write',
                    alternateUserId: 'alt-1',
                    isUser: true,
                    remoteIpAddress: '10.0.0.1',
                    ...overrides
                }
            }),
            headers: []
        };
    }

    // ========================================================================================
    // buildRangeOutputKeys
    // ========================================================================================
    describe('buildRangeOutputKeys', () => {
        test('nests result and error files under output/ alongside the input file', () => {
            expect(handler.buildRangeOutputKeys({ key: 'run-20260521/Patient.ndjson', rangeIndex: 0 }))
                .toEqual({
                    resultKey: 'run-20260521/output/Patient-001.ndjson',
                    errorKey: 'run-20260521/output/errors/Patient-001-errors.ndjson'
                });
        });

        test('handles a key at the bucket root (no directory component)', () => {
            expect(handler.buildRangeOutputKeys({ key: 'Patient.ndjson', rangeIndex: 4 }))
                .toEqual({
                    resultKey: 'output/Patient-005.ndjson',
                    errorKey: 'output/errors/Patient-005-errors.ndjson'
                });
        });

        test('RULE 10 sensitivity: rangeIndex is zero-padded to 3 digits and never collides', () => {
            const a = handler.buildRangeOutputKeys({ key: 'd/P.ndjson', rangeIndex: 0 });
            const b = handler.buildRangeOutputKeys({ key: 'd/P.ndjson', rangeIndex: 9 });
            const c = handler.buildRangeOutputKeys({ key: 'd/P.ndjson', rangeIndex: 99 });
            expect(a.resultKey).toBe('d/output/P-001.ndjson');
            expect(b.resultKey).toBe('d/output/P-010.ndjson');
            expect(c.resultKey).toBe('d/output/P-100.ndjson');
        });

        test('strips the .ndjson extension case-insensitively', () => {
            expect(handler.buildRangeOutputKeys({ key: 'd/Patient.NDJSON', rangeIndex: 0 }).resultKey)
                .toBe('d/output/Patient-001.ndjson');
        });
    });

    // ========================================================================================
    // buildNdjson
    // ========================================================================================
    describe('buildNdjson', () => {
        test('emits one JSON object per line with a trailing newline', () => {
            const entries = [
                new MergeResultEntry({ id: 'a', uuid: 'uuid-a', resourceType: 'Patient', created: true, updated: false }),
                new MergeResultEntry({ id: 'b', uuid: 'uuid-b', resourceType: 'Patient', created: false, updated: true })
            ];
            const ndjson = handler.buildNdjson(entries);
            const lines = ndjson.split('\n');

            expect(lines).toHaveLength(3);
            expect(lines[2]).toBe('');
            expect(JSON.parse(lines[0])).toMatchObject({ id: 'a', uuid: 'uuid-a', created: true });
            expect(JSON.parse(lines[1])).toMatchObject({ id: 'b', uuid: 'uuid-b', updated: true });
        });
    });

    // ========================================================================================
    // applyDefaultSecurityTagsIfMissing — ownership stamping
    // ========================================================================================
    describe('applyDefaultSecurityTagsIfMissing', () => {
        test('stamps default owner + sourceAssigningAuthority when the line carries no meta', () => {
            const result = handler.applyDefaultSecurityTagsIfMissing({ resourceType: 'Patient', id: 'p1' });

            expect(result.meta.security).toEqual([
                { system: SecurityTagSystem.owner, code: BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY }
            ]);
            expect(result.meta.source).toBe(BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY);
        });

        test('stamps defaults when meta.security is present but empty', () => {
            const result = handler.applyDefaultSecurityTagsIfMissing({
                resourceType: 'Patient', id: 'p1', meta: { security: [] }
            });
            expect(result.meta.security).toHaveLength(2);
        });

        test('SECURITY: never overwrites a tenant\'s own owner/access tags with the bwell default', () => {
            const result = handler.applyDefaultSecurityTagsIfMissing(
                makePatient({ id: 'p1', owner: 'client-a', access: 'client-a', sourceAssigningAuthority: 'client-a' })
            );

            expect(result.meta.security.map((t) => t.code)).toEqual(['client-a', 'client-a', 'client-a']);
            expect(result.meta.security.map((t) => t.code)).not.toContain(BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY);
        });

        test('preserves an already-supplied meta.source', () => {
            const result = handler.applyDefaultSecurityTagsIfMissing({
                resourceType: 'Patient', id: 'p1', meta: { source: 'https://partner.example.com' }
            });
            expect(result.meta.source).toBe('https://partner.example.com');
        });
    });

    // ========================================================================================
    // buildRangeRequestInfo
    // ========================================================================================
    describe('buildRangeRequestInfo', () => {
        test('maps the event identity fields onto a kafka-protocol FhirRequestInfo', () => {
            const info = handler.buildRangeRequestInfo({
                user: 'practitioner/dr-smith',
                scope: 'user/*.write',
                alternateUserId: 'alt-1',
                isUser: true,
                remoteIpAddress: '10.0.0.1'
            });

            expect(info).toBeInstanceOf(FhirRequestInfo);
            expect(info.user).toBe('practitioner/dr-smith');
            expect(info.scope).toBe('user/*.write');
            expect(info.alternateUserId).toBe('alt-1');
            expect(info.isUser).toBe(true);
            expect(info.remoteIpAddress).toBe('10.0.0.1');
            expect(info.protocol).toBe('kafka');
            expect(info.originalUrl).toBe('$import');
        });

        test('coerces missing identity fields to null/false rather than undefined', () => {
            const info = handler.buildRangeRequestInfo({});
            expect(info.user).toBeNull();
            expect(info.scope).toBeNull();
            expect(info.alternateUserId).toBeNull();
            expect(info.isUser).toBe(false);
        });

        test('mints a fresh requestId per range so concurrent ranges never share the bulk-inserter buffer', () => {
            const a = handler.buildRangeRequestInfo({ user: 'u', scope: 's' });
            const b = handler.buildRangeRequestInfo({ user: 'u', scope: 's' });
            expect(a.requestId).not.toBe(b.requestId);
        });
    });

    // ========================================================================================
    // parseImportRangeRequestedEvent
    // ========================================================================================
    describe('parseImportRangeRequestedEvent', () => {
        test('returns the CloudEvent data for a well-formed event', () => {
            const data = handler.parseImportRangeRequestedEvent(rangeMessage().value);
            expect(data.taskId).toBe('task-1');
            expect(data.filepath).toBe('s3://allowed-bucket/run/Patient.ndjson');
        });

        test('throws when the event type is not ImportRangeRequested', () => {
            const msg = JSON.stringify({ type: 'SomethingElse', data: { taskId: 't', filepath: 'f' } });
            expect(() => handler.parseImportRangeRequestedEvent(msg)).toThrow('Unexpected event type');
        });

        test('throws when filepath is missing', () => {
            const msg = JSON.stringify({ type: 'ImportRangeRequested', data: { taskId: 't' } });
            expect(() => handler.parseImportRangeRequestedEvent(msg)).toThrow('missing taskId or filepath');
        });
    });

    // ========================================================================================
    // findExistingResourceForIfNoneExistAsync (no cross-tenant existence oracle)
    // ========================================================================================
    describe('findExistingResourceForIfNoneExistAsync', () => {
        test('throws when the ifNoneExist query is empty or whitespace', async () => {
            await expect(handler.findExistingResourceForIfNoneExistAsync({
                resourceType: 'Patient', ifNoneExist: '   ', ownerCode: 'client-a'
            })).rejects.toThrow('ifNoneExist is empty');
        });

        test('fails closed when no owner tag can be resolved to scope the existence check', async () => {
            await expect(handler.findExistingResourceForIfNoneExistAsync({
                resourceType: 'Patient', ifNoneExist: 'identifier=sys|1', ownerCode: undefined
            })).rejects.toThrow('Cannot resolve an owner tag');
            expect(deps.databaseQueryFactory.createQuery).not.toHaveBeenCalled();
        });

        test('ANDs the caller\'s owner tag onto the query so a match cannot come from another tenant', async () => {
            const findOneAsync = jestGlobal.fn().mockResolvedValue(null);
            deps.databaseQueryFactory.createQuery.mockReturnValue({ findOneAsync });

            await handler.findExistingResourceForIfNoneExistAsync({
                resourceType: 'Patient', ifNoneExist: 'identifier=sys%7C1', ownerCode: 'client-a'
            });

            const { query } = findOneAsync.mock.calls[0][0];
            expect(query.$and).toHaveLength(2);
            expect(query.$and[1]).toEqual({
                'meta.security': {
                    $elemMatch: { system: SecurityTagSystem.owner, code: 'client-a' }
                }
            });
        });

        test('parses with strict search-parameter handling so a mistyped param cannot fail open', async () => {
            deps.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            await handler.findExistingResourceForIfNoneExistAsync({
                resourceType: 'Patient', ifNoneExist: 'identifier=sys%7C1', ownerCode: 'client-a'
            });

            expect(deps.r4ArgsParser.parseArgs).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Patient',
                    args: expect.objectContaining({ handling: STRICT_SEARCH_HANDLING, base_version: '4_0_0' })
                })
            );
        });

        test('RULE 10 sensitivity: a different ownerCode produces a different scoped query', async () => {
            const findOneAsync = jestGlobal.fn().mockResolvedValue(null);
            deps.databaseQueryFactory.createQuery.mockReturnValue({ findOneAsync });

            await handler.findExistingResourceForIfNoneExistAsync({
                resourceType: 'Patient', ifNoneExist: 'identifier=sys%7C1', ownerCode: 'client-a'
            });
            await handler.findExistingResourceForIfNoneExistAsync({
                resourceType: 'Patient', ifNoneExist: 'identifier=sys%7C1', ownerCode: 'client-b'
            });

            expect(findOneAsync.mock.calls[0][0].query.$and[1]['meta.security'].$elemMatch.code).toBe('client-a');
            expect(findOneAsync.mock.calls[1][0].query.$and[1]['meta.security'].$elemMatch.code).toBe('client-b');
        });
    });

    // ========================================================================================
    // readRangeWithRetryAsync — retry legality
    // ========================================================================================
    describe('readRangeWithRetryAsync', () => {
        test('returns on first success without touching the request cache', async () => {
            const fn = jestGlobal.fn().mockResolvedValue(undefined);
            await handler.readRangeWithRetryAsync({ fn, requestId: 'req-1' });

            expect(fn).toHaveBeenCalledTimes(1);
            expect(deps.requestSpecificCache.clearAsync).not.toHaveBeenCalled();
        });

        test('retries a transient failure and clears the request-scoped buffer between attempts', async () => {
            const fn = jestGlobal.fn()
                .mockRejectedValueOnce(new Error('ECONNRESET'))
                .mockResolvedValue(undefined);

            await handler.readRangeWithRetryAsync({ fn, requestId: 'req-1', attempts: 3 });

            expect(fn).toHaveBeenCalledTimes(2);
            expect(deps.requestSpecificCache.clearAsync).toHaveBeenCalledWith({ requestId: 'req-1' });
        });

        test('does NOT retry once a batch has already been durably flushed', async () => {
            const error = Object.assign(new Error('stream aborted'), { bulkImportRangePartiallyFlushed: true });
            const fn = jestGlobal.fn().mockRejectedValue(error);

            await expect(handler.readRangeWithRetryAsync({ fn, requestId: 'req-1', attempts: 3 }))
                .rejects.toBe(error);
            expect(fn).toHaveBeenCalledTimes(1);
            expect(deps.requestSpecificCache.clearAsync).not.toHaveBeenCalled();
        });

        test('does NOT retry a deterministic (retryable=false) input error', async () => {
            const error = Object.assign(new Error('line exceeds 16 MB'), { retryable: false });
            const fn = jestGlobal.fn().mockRejectedValue(error);

            await expect(handler.readRangeWithRetryAsync({ fn, requestId: 'req-1', attempts: 3 }))
                .rejects.toBe(error);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        test('RULE 11 boundary: gives up after exactly `attempts` tries and throws the last error', async () => {
            const last = new Error('attempt 2 failed');
            const fn = jestGlobal.fn()
                .mockRejectedValueOnce(new Error('attempt 1 failed'))
                .mockRejectedValueOnce(last);

            await expect(handler.readRangeWithRetryAsync({ fn, requestId: 'req-1', attempts: 2 }))
                .rejects.toBe(last);
            expect(fn).toHaveBeenCalledTimes(2);
            // the cache is cleared only between attempts, not after the final failure
            expect(deps.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
        });
    });

    // ========================================================================================
    // writeNdjsonWithRetryAsync
    // ========================================================================================
    describe('writeNdjsonWithRetryAsync', () => {
        test('retries a transient S3 write failure and succeeds', async () => {
            deps.s3NdjsonReader.writeNdjsonAsync
                .mockRejectedValueOnce(new Error('SlowDown'))
                .mockResolvedValue(undefined);

            await handler.writeNdjsonWithRetryAsync({ filepath: 's3://b/out.ndjson', data: 'x\n', attempts: 2 });

            expect(deps.s3NdjsonReader.writeNdjsonAsync).toHaveBeenCalledTimes(2);
        });

        test('propagates the failure after exhausting attempts so the range is not reported complete', async () => {
            deps.s3NdjsonReader.writeNdjsonAsync.mockRejectedValue(new Error('AccessDenied'));

            await expect(handler.writeNdjsonWithRetryAsync({
                filepath: 's3://b/out.ndjson', data: 'x\n', attempts: 2
            })).rejects.toThrow('AccessDenied');
            expect(deps.s3NdjsonReader.writeNdjsonAsync).toHaveBeenCalledTimes(2);
            expect(logError).toHaveBeenCalledWith(
                'S3 NDJSON write attempt failed',
                expect.objectContaining({ attempt: 2, attempts: 2 })
            );
        });
    });

    // ========================================================================================
    // reportRangeCompletedAsync
    // ========================================================================================
    describe('reportRangeCompletedAsync', () => {
        function entry ({ id, byteOffset, failed = false }) {
            if (failed) {
                return MergeResultEntry.createFromError({
                    error: new Error(`bad ${id}`),
                    resource: { resourceType: 'Patient', id },
                    sourceByteOffset: byteOffset
                });
            }
            return new MergeResultEntry({
                id, uuid: `uuid-${id}`, resourceType: 'Patient',
                created: true, updated: false, sourceByteOffset: byteOffset
            });
        }

        test('restores source order by byte offset before writing the result NDJSON', async () => {
            await handler.reportRangeCompletedAsync({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/run/Patient.ndjson',
                rangeIndex: 0,
                taskTotalRanges: 1,
                mergeResultEntries: [
                    entry({ id: 'c', byteOffset: 300 }),
                    entry({ id: 'a', byteOffset: 100 }),
                    entry({ id: 'b', byteOffset: 200 })
                ]
            });

            const { data } = deps.s3NdjsonReader.writeNdjsonAsync.mock.calls[0][0];
            const ids = data.trim().split('\n').map((l) => JSON.parse(l).id);
            expect(ids).toEqual(['a', 'b', 'c']);
        });

        test('publishes ImportRangeCompleted with the result URI and a null error URI when nothing failed', async () => {
            await handler.reportRangeCompletedAsync({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/run/Patient.ndjson',
                rangeIndex: 0,
                taskTotalRanges: 3,
                mergeResultEntries: [entry({ id: 'a', byteOffset: 0 })]
            });

            expect(deps.s3NdjsonReader.writeNdjsonAsync).toHaveBeenCalledTimes(1);
            expect(deps.bulkImportEventProducer.publishRangeProgressEventAsync).toHaveBeenCalledWith({
                type: 'ImportRangeCompleted',
                data: {
                    taskId: 'task-1',
                    filepath: 's3://allowed-bucket/run/Patient.ndjson',
                    rangeIndex: 0,
                    taskTotalRanges: 3,
                    resultUri: 's3://allowed-bucket/run/output/Patient-001.ndjson',
                    errorUri: null
                }
            });
        });

        test('writes a second error NDJSON containing only the failed entries', async () => {
            await handler.reportRangeCompletedAsync({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/run/Patient.ndjson',
                rangeIndex: 0,
                taskTotalRanges: 1,
                mergeResultEntries: [entry({ id: 'ok', byteOffset: 0 }), entry({ id: 'bad', byteOffset: 10, failed: true })]
            });

            expect(deps.s3NdjsonReader.writeNdjsonAsync).toHaveBeenCalledTimes(2);
            const errorPayload = deps.s3NdjsonReader.writeNdjsonAsync.mock.calls[1][0];
            expect(errorPayload.filepath).toBe('s3://allowed-bucket/run/output/errors/Patient-001-errors.ndjson');
            const errorIds = errorPayload.data.trim().split('\n').map((l) => JSON.parse(l).id);
            expect(errorIds).toEqual(['bad']);
        });

        test('RULE 11 boundary: an empty range writes no S3 objects and reports a null result URI', async () => {
            await handler.reportRangeCompletedAsync({
                taskId: 'task-1',
                filepath: 's3://allowed-bucket/run/Patient.ndjson',
                rangeIndex: 0,
                taskTotalRanges: 1,
                mergeResultEntries: []
            });

            expect(deps.s3NdjsonReader.writeNdjsonAsync).not.toHaveBeenCalled();
            expect(deps.bulkImportEventProducer.publishRangeProgressEventAsync)
                .toHaveBeenCalledWith(expect.objectContaining({
                    data: expect.objectContaining({ resultUri: null, errorUri: null })
                }));
        });
    });

    // ========================================================================================
    // handleImportRangeRequestedAsync — the main worker orchestration method (RULE 8)
    // ========================================================================================
    describe('handleImportRangeRequestedAsync', () => {
        test('happy path: reports started, merges each line, reports completed, and cleans up', async () => {
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({ lineNumber: 1, byteOffset: 0, resource: makePatient({ id: 'p1', owner: 'client-a' }) })
            ]));

            await handler.handleImportRangeRequestedAsync(rangeMessage());

            const published = deps.bulkImportEventProducer.publishRangeProgressEventAsync.mock.calls.map((c) => c[0].type);
            expect(published).toEqual(['ImportRangeStarted', 'ImportRangeCompleted']);
            expect(deps.mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            expect(deps.fastDatabaseBulkInserter.executeAsync).toHaveBeenCalled();
            expect(deps.auditLogger.flushAsync).toHaveBeenCalledTimes(1);
            expect(deps.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
        });

        test('SECURITY: the resource\'s own security tags reach mergeManager unchanged', async () => {
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({
                    resource: makePatient({
                        id: 'p1', owner: 'client-a', access: 'client-a', sourceAssigningAuthority: 'client-a'
                    })
                })
            ]));

            await handler.handleImportRangeRequestedAsync(rangeMessage());

            const merged = deps.mergeManager.mergeResourceAsync.mock.calls[0][0].resourceToMerge;
            const codes = merged.meta.security.map((t) => `${t.system}|${t.code}`);
            expect(codes).toContain(`${SecurityTagSystem.owner}|client-a`);
            expect(codes).toContain(`${SecurityTagSystem.access}|client-a`);
            expect(codes).toContain(`${SecurityTagSystem.sourceAssigningAuthority}|client-a`);
        });

        test('SECURITY: a scope rejection blocks the merge and is recorded as a failure', async () => {
            const scopeError = new MergeResultEntry({
                id: 'p1', uuid: 'uuid-of-p1', resourceType: 'Patient', created: false, updated: false,
                issue: { severity: 'error', code: 'forbidden' },
                operationOutcome: { resourceType: 'OperationOutcome' }
            });
            deps.writeAllowedByScopesValidator.validate.mockResolvedValue({ preCheckErrors: [scopeError] });
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({ resource: makePatient({ id: 'p1', owner: 'other-tenant' }) })
            ]));

            await handler.handleImportRangeRequestedAsync(rangeMessage());

            expect(deps.mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
            // the rejection lands in the error NDJSON for the range
            const errorWrite = deps.s3NdjsonReader.writeNdjsonAsync.mock.calls
                .find((c) => c[0].filepath.includes('/errors/'));
            expect(errorWrite).toBeDefined();
        });

        test('an unparseable NDJSON line is recorded as a failure without aborting the range', async () => {
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({ lineNumber: 1, byteOffset: 0, parseError: new Error('Unexpected token }') }),
                makeLine({ lineNumber: 2, byteOffset: 40, resource: makePatient({ id: 'p2', owner: 'client-a' }) })
            ]));

            await handler.handleImportRangeRequestedAsync(rangeMessage());

            // the good line still merged
            expect(deps.mergeManager.mergeResourceAsync).toHaveBeenCalledTimes(1);
            // the range still reported completion, with an error file for the bad line
            const types = deps.bulkImportEventProducer.publishRangeProgressEventAsync.mock.calls.map((c) => c[0].type);
            expect(types).toContain('ImportRangeCompleted');
            const errorWrite = deps.s3NdjsonReader.writeNdjsonAsync.mock.calls
                .find((c) => c[0].filepath.includes('/errors/'));
            expect(errorWrite).toBeDefined();
        });

        test('an ifNoneExist match skips the resource entirely (no merge, no attachment transform)', async () => {
            deps.databaseQueryFactory.createQuery.mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue({ resourceType: 'Patient', id: 'existing' })
            });
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({
                    resource: {
                        ifNoneExist: 'identifier=sys%7C1',
                        resource: makePatient({ id: 'p1', owner: 'client-a' })
                    }
                })
            ]));

            await handler.handleImportRangeRequestedAsync(rangeMessage());

            expect(deps.mergeManager.mergeResourceAsync).not.toHaveBeenCalled();
            const resultWrite = deps.s3NdjsonReader.writeNdjsonAsync.mock.calls[0][0];
            const reported = JSON.parse(resultWrite.data.trim());
            expect(reported.created).toBe(false);
            expect(reported.updated).toBe(false);
        });

        test('RULE 11 boundary: batchSize=2 flushes once for exactly 2 lines and twice for 3', async () => {
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({ lineNumber: 1, byteOffset: 0, resource: makePatient({ id: 'p1', owner: 'client-a' }) }),
                makeLine({ lineNumber: 2, byteOffset: 10, resource: makePatient({ id: 'p2', owner: 'client-a' }) })
            ]));
            await handler.handleImportRangeRequestedAsync(rangeMessage());
            expect(deps.fastDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(1);

            jestGlobal.clearAllMocks();
            queuedTasks = [];
            deps.mergeManager.mergeResourceAsync.mockResolvedValue(null);
            deps.databaseBulkLoader.getResourceFromExistingList.mockReturnValue(null);
            deps.writeAllowedByScopesValidator.validate.mockResolvedValue({ preCheckErrors: [] });
            deps.s3NdjsonReader.parseS3Uri.mockImplementation((uri) => {
                const m = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
                return { bucket: m[1], key: m[2] };
            });
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({ lineNumber: 1, byteOffset: 0, resource: makePatient({ id: 'p1', owner: 'client-a' }) }),
                makeLine({ lineNumber: 2, byteOffset: 10, resource: makePatient({ id: 'p2', owner: 'client-a' }) }),
                makeLine({ lineNumber: 3, byteOffset: 20, resource: makePatient({ id: 'p3', owner: 'client-a' }) })
            ]));
            await handler.handleImportRangeRequestedAsync(rangeMessage());
            expect(deps.fastDatabaseBulkInserter.executeAsync).toHaveBeenCalledTimes(2);
        });

        test('RULE 11 N>1: a same-batch duplicate _uuid is counted as an update, not a second create', async () => {
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({ lineNumber: 1, byteOffset: 0, resource: makePatient({ id: 'dup', owner: 'client-a' }) }),
                makeLine({ lineNumber: 2, byteOffset: 10, resource: makePatient({ id: 'dup', owner: 'client-a' }) })
            ]));

            await handler.handleImportRangeRequestedAsync(rangeMessage());

            const resultWrite = deps.s3NdjsonReader.writeNdjsonAsync.mock.calls[0][0];
            const entries = resultWrite.data.trim().split('\n').map((l) => JSON.parse(l));
            expect(entries).toHaveLength(2);
            expect(entries[0].created).toBe(true);
            expect(entries[1].created).toBe(false);
            expect(entries[1].updated).toBe(true);
        });

        test('a read failure publishes ImportRangeFailed instead of ImportRangeCompleted', async () => {
            const readError = Object.assign(new Error('S3 stream aborted'), { retryable: false });
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(async function * () {
                throw readError;
                // eslint-disable-next-line no-unreachable
                yield null;
            });

            await handler.handleImportRangeRequestedAsync(rangeMessage());

            const types = deps.bulkImportEventProducer.publishRangeProgressEventAsync.mock.calls.map((c) => c[0].type);
            expect(types).toEqual(['ImportRangeStarted', 'ImportRangeFailed']);
            const failedEvent = deps.bulkImportEventProducer.publishRangeProgressEventAsync.mock.calls[1][0];
            expect(failedEvent.data.errorMessage).toBe('S3 stream aborted');
            // cleanup still happens on the failure path
            expect(deps.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
        });

        test('an AuditEvent flush failure is contained and does not prevent request-cache cleanup', async () => {
            deps.auditLogger.flushAsync.mockRejectedValue(new Error('mongo write failed'));
            deps.s3NdjsonReader.readNdjsonAsync.mockImplementation(ndjsonLines([
                makeLine({ resource: makePatient({ id: 'p1', owner: 'client-a' }) })
            ]));

            await expect(handler.handleImportRangeRequestedAsync(rangeMessage())).resolves.toBeUndefined();

            expect(logError).toHaveBeenCalledWith(
                'Failed to flush AuditEvents for bulk import range',
                expect.objectContaining({ error: 'mongo write failed' })
            );
            expect(deps.requestSpecificCache.clearAsync).toHaveBeenCalledTimes(1);
        });

        test('a malformed ImportRangeRequested message is logged and swallowed, not thrown', async () => {
            await expect(handler.handleImportRangeRequestedAsync({
                key: 'k', value: '{not json', headers: []
            })).resolves.toBeUndefined();

            expect(logError).toHaveBeenCalledWith(
                'Failed to parse bulk import Kafka message',
                expect.objectContaining({ key: 'k' })
            );
            expect(deps.bulkImportEventProducer.publishRangeProgressEventAsync).not.toHaveBeenCalled();
        });
    });

    // ========================================================================================
    // queueAuditEntriesForRangeAsync
    // ========================================================================================
    describe('queueAuditEntriesForRangeAsync', () => {
        function makeEntries () {
            return [
                new MergeResultEntry({ id: 'c1', uuid: 'uuid-c1', resourceType: 'Patient', created: true, updated: false }),
                new MergeResultEntry({ id: 'u1', uuid: 'uuid-u1', resourceType: 'Patient', created: false, updated: true }),
                new MergeResultEntry({
                    id: 'f1', uuid: 'uuid-f1', resourceType: 'Observation', created: false, updated: false,
                    issue: { severity: 'error', code: 'exception' }
                })
            ];
        }

        test('queues a deferred task rather than writing audits inline', () => {
            handler.queueAuditEntriesForRangeAsync({
                requestInfo: handler.buildRangeRequestInfo({}),
                base_version: '4_0_0',
                mergeResultEntries: makeEntries(),
                taskId: 't', filepath: 'f', rangeIndex: 0, totalRanges: 1
            });

            expect(deps.postRequestProcessor.add).toHaveBeenCalledTimes(1);
            expect(deps.auditLogger.logAuditEntryAsync).not.toHaveBeenCalled();
        });

        test('groups by resourceType and logs create/update audits with the resource uuids', async () => {
            handler.queueAuditEntriesForRangeAsync({
                requestInfo: handler.buildRangeRequestInfo({}),
                base_version: '4_0_0',
                mergeResultEntries: makeEntries(),
                taskId: 't', filepath: 'f', rangeIndex: 0, totalRanges: 1
            });
            await deps.postRequestProcessor.executeAsync({ requestId: 'x' });

            expect(deps.auditLogger.logAuditEntryAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Patient', operation: 'create', ids: ['uuid-c1'] })
            );
            expect(deps.auditLogger.logAuditEntryAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Patient', operation: 'update', ids: ['uuid-u1'] })
            );
            expect(deps.auditLogger.logErrorAuditEntryAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Observation', errorCode: 400 })
            );
        });

        test('never logs success audits for AuditEvent itself but still logs its error audits', async () => {
            handler.queueAuditEntriesForRangeAsync({
                requestInfo: handler.buildRangeRequestInfo({}),
                base_version: '4_0_0',
                mergeResultEntries: [
                    new MergeResultEntry({ id: 'a1', uuid: 'uuid-a1', resourceType: 'AuditEvent', created: true, updated: false }),
                    new MergeResultEntry({
                        id: 'a2', uuid: 'uuid-a2', resourceType: 'AuditEvent', created: false, updated: false,
                        issue: { severity: 'error', code: 'exception' }
                    })
                ],
                taskId: 't', filepath: 'f', rangeIndex: 0, totalRanges: 1
            });
            await deps.postRequestProcessor.executeAsync({ requestId: 'x' });

            expect(deps.auditLogger.logAuditEntryAsync).not.toHaveBeenCalled();
            expect(deps.auditLogger.logErrorAuditEntryAsync).toHaveBeenCalledTimes(1);
        });

        test('RULE 11 boundary: an empty range queues a task that writes no audits', async () => {
            handler.queueAuditEntriesForRangeAsync({
                requestInfo: handler.buildRangeRequestInfo({}),
                base_version: '4_0_0',
                mergeResultEntries: [],
                taskId: 't', filepath: 'f', rangeIndex: 0, totalRanges: 1
            });
            await deps.postRequestProcessor.executeAsync({ requestId: 'x' });

            expect(deps.auditLogger.logAuditEntryAsync).not.toHaveBeenCalled();
            expect(deps.auditLogger.logErrorAuditEntryAsync).not.toHaveBeenCalled();
        });
    });
});
