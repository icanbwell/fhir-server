const path = require('path');
const { describe, test, expect, jest, afterEach } = require('@jest/globals');

const mockLoggedCalls = [];
jest.mock('../../../../../../operations/common/logging', () => {
    const actual = jest.requireActual('../../../../../../operations/common/logging');
    return {
        ...actual,
        logInfo: (...args) => {
            mockLoggedCalls.push(args);
            return actual.logInfo(...args);
        },
        logError: (...args) => {
            mockLoggedCalls.push(args);
            return actual.logError(...args);
        }
    };
});

/**
 * Makes the schema check throw an unexpected error for the body with the id `throwsForId`, and run
 * unchanged for every other body, while `throwsForId` is set.
 */
const mockSchemaCheck = { throwsForId: null };
jest.mock('../../../../../../utils/validator.util', () => {
    const { jest: j } = require('@jest/globals');
    const actual = j.requireActual('../../../../../../utils/validator.util');
    return {
        ...actual,
        validateResource: (args) => {
            const { throwsForId } = mockSchemaCheck;
            if (throwsForId !== null && args?.resourceBody?.id === throwsForId) {
                throw new TypeError('unexpected schema check failure');
            }
            return actual.validateResource(args);
        }
    };
});

const { createTestRequest } = require('../../../../common');
const {
    EXPECTED_DIRECTORY,
    SCOPE_ALL,
    withOversizedNames,
    registerImportTestHooks,
    fixture,
    fixtureWithId,
    fixtureChanged,
    useWritePath,
    withEachPath,
    expectedFileOf,
    writesExpectedFile,
    expectMatchesExpectedFile,
    startImportAsync,
    createImportContainer,
    recordRangeAsync
} = require('./importTestSetup');

const FLUSH_EXPECTED_DIRECTORY = path.join(EXPECTED_DIRECTORY, 'flush');
const RANGE_USER = 'import-parity-user';
const CHECK_THROWS_ID = 'import-check-throws';
const SCHEMA_THROWS_ID = 'import-schema-throws';
const OBSERVATION_WRITE_ERROR = 'synthetic Observation write refused';
const BUILD_THROWS_ID = 'import-build-throws';
const WRITE_THROWS_ID = 'import-write-throws';
const WRITE_STEP_FAILED_MESSAGE = 'Write step failed for resource';
const CLIENT_B_SECURITY = [
    { system: 'https://www.icanbwell.com/owner', code: 'client-b' },
    { system: 'https://www.icanbwell.com/access', code: 'client-b' },
    { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'client-b' }
];

/**
 * Makes the range's flushes of the bulk inserter throw, as a database that is unavailable would:
 * the flushes whose 1-based position in the range is in `failingFlushes`, or every one when it is
 * `'all'`. The AuditEvent flush, which passes its own operations, and the Task writes of the
 * orchestrator, which run as no user, go through.
 */
const failRangeFlushes = (failingFlushes) => (container) => {
    const inserter = container.fastDatabaseBulkInserter;
    const executeAsync = inserter.executeAsync.bind(inserter);
    let rangeFlushes = 0;
    jest.spyOn(inserter, 'executeAsync').mockImplementation(async (args) => {
        if (!args.operationsMap && args.requestInfo.user === RANGE_USER) {
            rangeFlushes += 1;
            if (failingFlushes === 'all' || failingFlushes.includes(rangeFlushes)) {
                throw new Error('bulk write unavailable');
            }
        }
        return await executeAsync(args);
    });
};

/**
 * Makes the bulk inserter's write of the range's Observations to their collection throw an error
 * that is not a document size error, as a write the database refuses would, after the writes of
 * the other resource types of the same flush, which run in parallel on the real executor, have
 * finished. The flush therefore throws with the other types committed. History writes of
 * Observations go to the real executor.
 */
const failObservationWritesAfterOtherTypes = (container) => {
    const inserter = container.fastDatabaseBulkInserter;
    const realObservationExecutor = inserter.bulkWriteExecutors.find((executor) =>
        executor.canHandle('Observation')
    );
    const otherTypeWrites = [];
    for (const executor of inserter.bulkWriteExecutors) {
        const executeBulkAsync = executor.executeBulkAsync.bind(executor);
        jest.spyOn(executor, 'executeBulkAsync').mockImplementation((args) => {
            const write = executeBulkAsync(args);
            if (!args.useHistoryCollection) {
                otherTypeWrites.push(write.catch(() => {}));
            }
            return write;
        });
    }
    inserter.bulkWriteExecutors.unshift({
        canHandle: (resourceType) => resourceType === 'Observation',
        executeBulkAsync: async (args) => {
            if (args.useHistoryCollection) {
                return await realObservationExecutor.executeBulkAsync(args);
            }
            await Promise.all(otherTypeWrites);
            throw new Error(OBSERVATION_WRITE_ERROR);
        }
    });
};

/**
 * Makes the new-resource meta check throw an unexpected error for the line with id
 * `CHECK_THROWS_ID` only, as a bug in the validator would, and run unchanged for every other line.
 */
const throwInMetaCheckForOneLine = (container) => {
    const validator = container.resourceValidator;
    const validateResourceMetaSync = validator.validateResourceMetaSync.bind(validator);
    jest.spyOn(validator, 'validateResourceMetaSync').mockImplementation((resource) => {
        if (resource?.id === CHECK_THROWS_ID) {
            throw new TypeError('unexpected meta check failure');
        }
        return validateResourceMetaSync(resource);
    });
};

/**
 * Makes the schema check throw an unexpected error for the line with id `SCHEMA_THROWS_ID` only, as
 * a bug in the schema validator would, and run unchanged for every other line.
 */
const throwInSchemaCheckForOneLine = () => {
    mockSchemaCheck.throwsForId = SCHEMA_THROWS_ID;
};

/**
 * Makes the build of the line with id `BUILD_THROWS_ID` throw, as a bug in merging its Group
 * members would, and makes queueing the insert of the line with id `WRITE_THROWS_ID` throw, as a
 * bulk inserter that refuses the document would. Every other line is built and queued unchanged.
 */
const throwInBuildAndWriteForOneLineEach = (container) => {
    const groupMemberMerger = container.groupMemberMerger;
    const mergeMembers = groupMemberMerger.mergeMembers.bind(groupMemberMerger);
    jest.spyOn(groupMemberMerger, 'mergeMembers').mockImplementation((args) => {
        if (args.resource?.id === BUILD_THROWS_ID) {
            throw new Error('synthetic build failure');
        }
        return mergeMembers(args);
    });
    const inserter = container.fastDatabaseBulkInserter;
    const insertOneAsync = inserter.insertOneAsync.bind(inserter);
    jest.spyOn(inserter, 'insertOneAsync').mockImplementation(async (args) => {
        if (args.doc?.id === WRITE_THROWS_ID) {
            throw new Error('synthetic insert refused');
        }
        return await insertOneAsync(args);
    });
};

/**
 * Returns the types of the range progress events the worker published.
 */
const progressEventTypesOf = (container) =>
    container.kafkaClientV2.getCloudEventMessages().map(({ value }) => JSON.parse(value).type);

/**
 * Returns the `errorMessage` of each `ImportRangeFailed` event the worker published, which is the
 * reason the Task records for the failed range.
 */
const rangeFailureMessagesOf = (container) =>
    container.kafkaClientV2
        .getCloudEventMessages()
        .map(({ value }) => JSON.parse(value))
        .filter(({ type }) => type === 'ImportRangeFailed')
        .map(({ data }) => data.errorMessage);

describe('$import flush failures on the old and the new write path', () => {
    registerImportTestHooks();

    afterEach(() => {
        mockSchemaCheck.throwsForId = null;
    });

    /**
     * Each case has a stable `key`, which names its expected file under `expected/flush`, the NDJSON
     * `lines`, the `env` it needs, an optional `prepare` that changes the worker's container
     * before the range runs, and the `rangeFailureMessages` the worker publishes on each path. A case that differs on the new path sets `expectedNew` to the row of
     * the plan's differences that it shows.
     */
    const cases = [
        {
            key: 'laterBatchFlushThrows',
            name: 'fails the range without a retry when a later batch flush throws, keeping and auditing the batch flushed before it',
            env: { BULK_IMPORT_BATCH_SIZE: '2' },
            prepare: failRangeFlushes([2]),
            rangeFailureMessages: { old: ['bulk write unavailable'], new: ['bulk write unavailable'] },
            lines: [
                fixture('patient'),
                fixture('patientTwoOwnerTags'),
                fixtureWithId('patient', 'import-flush-later'),
                fixture('observation')
            ]
        },
        {
            key: 'firstBatchFlushThrows',
            name: 'reads the range three times and fails it when every flush throws before any batch is flushed',
            env: { BULK_IMPORT_BATCH_SIZE: '2' },
            prepare: failRangeFlushes('all'),
            rangeFailureMessages: { old: ['bulk write unavailable'], new: ['bulk write unavailable'] },
            lines: [fixture('patient'), fixture('patientTwoOwnerTags')]
        },
        {
            key: 'oversizedPatientInBatch',
            name: 'reports the lines of a flush in which one Patient is over the document size limit',
            expectedNew: 'difference 3: every Patient of the flush the database rejects is failed and frees its ifNoneExist key',
            env: { BULK_IMPORT_BATCH_SIZE: '4' },
            rangeFailureMessages: { old: [], new: [] },
            lines: [
                fixture('ifNoneExistPatient'),
                fixtureChanged('patient', (resource) => {
                    resource.id = 'import-oversized';
                    withOversizedNames(resource);
                }),
                fixture('observation'),
                fixtureWithId('patient', 'import-healthy-second'),
                fixture('ifNoneExistPatientSecond')
            ]
        },
        {
            key: 'checkThrowsForOneLine',
            name: 'fails only the line whose meta check throws an unexpected error',
            prepare: throwInMetaCheckForOneLine,
            rangeFailureMessages: { old: [], new: [] },
            lines: [
                fixture('patient'),
                fixtureWithId('patient', CHECK_THROWS_ID),
                fixture('observation')
            ]
        },
        {
            key: 'partialCommitFlushThrows',
            name: 'keeps and audits the Patient a flush committed before its Observation write threw, and fails the range',
            expectedNew: 'a flush of more than one resource type that throws is not read again, so the Patient it committed is counted and audited created, where the old path reads the range three times and counts and audits it updated',
            prepare: failObservationWritesAfterOtherTypes,
            rangeFailureMessages: { old: [OBSERVATION_WRITE_ERROR], new: [OBSERVATION_WRITE_ERROR] },
            lines: [fixture('patient'), fixture('observation')]
        },
        {
            key: 'laterBatchFlushThrowsAfterPartialCommit',
            name: 'keeps and audits both batches when the later flush commits its Patient before its Observation write throws',
            env: { BULK_IMPORT_BATCH_SIZE: '2' },
            prepare: failObservationWritesAfterOtherTypes,
            rangeFailureMessages: { old: [OBSERVATION_WRITE_ERROR], new: [OBSERVATION_WRITE_ERROR] },
            lines: [
                fixture('patient'),
                fixtureWithId('patient', 'import-partial-earlier'),
                fixtureWithId('patient', 'import-partial-later'),
                fixture('observation')
            ]
        },
        {
            key: 'oversizedPatientOtherOwner',
            name: 'reports a healthy Patient of another owner in a flush in which one Patient is over the document size limit',
            expectedNew: 'both Patients of the flush the database rejects are failed, whichever owner each has',
            rangeFailureMessages: { old: [], new: [] },
            storedPatientIds: { old: [], new: [] },
            failedLineIds: {
                old: [],
                new: ['import-oversized-client-a', 'import-healthy-client-b']
            },
            lines: [
                fixtureChanged('patient', (resource) => {
                    resource.id = 'import-oversized-client-a';
                    withOversizedNames(resource);
                }),
                fixtureChanged('patient', (resource) => {
                    resource.id = 'import-healthy-client-b';
                    resource.meta.security = CLIENT_B_SECURITY;
                })
            ]
        },
        {
            key: 'singleTypeFlushThrowsOnce',
            name: 'reads the range again when a flush of one resource type throws once, creating and auditing each Patient once',
            prepare: failRangeFlushes([1]),
            rangeFailureMessages: { old: [], new: [] },
            lines: [fixture('patient'), fixtureWithId('patient', 'import-single-type-second')]
        }
    ];

    test.each(withEachPath(cases))('$name on the $writePath path', async ({
        key,
        writePath,
        expectedNew,
        lines,
        env = {},
        prepare = () => {},
        rangeFailureMessages,
        storedPatientIds,
        failedLineIds
    }) => {
        const request = await createTestRequest();
        Object.assign(process.env, env);
        useWritePath(writePath);
        await startImportAsync(request);
        const container = createImportContainer(lines);
        prepare(container);

        const recorded = await recordRangeAsync({ request, container, scope: SCOPE_ALL });

        expectMatchesExpectedFile({
            recorded: { ...recorded, progressEvents: progressEventTypesOf(container) },
            file: expectedFileOf({ directory: FLUSH_EXPECTED_DIRECTORY, key, expectedNew, writePath }),
            write: writesExpectedFile({ expectedNew, writePath })
        });
        expect(rangeFailureMessagesOf(container)).toStrictEqual(rangeFailureMessages[writePath]);
        if (storedPatientIds) {
            expect((recorded.stored.Patient_4_0_0 ?? []).map(({ id }) => id)).toStrictEqual(
                storedPatientIds[writePath]
            );
        }
        if (failedLineIds) {
            expect(recorded.errors.map(({ id }) => id)).toStrictEqual(failedLineIds[writePath]);
        }
    });

    test.each(['old', 'new'])(
        'fails only the line whose schema check throws an unexpected error, and completes the range, on the %s path',
        async (writePath) => {
            const request = await createTestRequest();
            useWritePath(writePath);
            await startImportAsync(request);
            const container = createImportContainer([
                fixture('patient'),
                fixtureWithId('patient', SCHEMA_THROWS_ID),
                fixture('observation')
            ]);
            throwInSchemaCheckForOneLine();

            const recorded = await recordRangeAsync({ request, container, scope: SCOPE_ALL });

            expect(rangeFailureMessagesOf(container)).toStrictEqual([]);
            expect(progressEventTypesOf(container)).toStrictEqual([
                'ImportRangeStarted',
                'ImportRangeCompleted'
            ]);
            expect(recorded.spanAttributes).toStrictEqual([
                {
                    'fhir_import.resources_created': 2,
                    'fhir_import.resources_updated': 0,
                    'fhir_import.resources_failed': 1
                }
            ]);
            const results = recorded.result.map(({ id, created, updated }) => ({
                id,
                created,
                updated
            }));
            expect(results).toStrictEqual([
                { id: 'import-patient-1', created: true, updated: false },
                { id: SCHEMA_THROWS_ID, created: false, updated: false },
                { id: 'import-observation-1', created: true, updated: false }
            ]);
            expect(recorded.errors.map(({ id }) => id)).toStrictEqual([SCHEMA_THROWS_ID]);
            expect(recorded.errors[0].issue.diagnostics).toContain(
                'unexpected schema check failure'
            );
            expect((recorded.stored.Patient_4_0_0 ?? []).map(({ id }) => id)).toStrictEqual([
                'import-patient-1'
            ]);
            expect((recorded.stored.Observation_4_0_0 ?? []).map(({ id }) => id)).toStrictEqual([
                'import-observation-1'
            ]);
            expect(recorded.auditEvents.map(({ action }) => action)).toStrictEqual(['C', 'C', 'E']);
        }
    );

    test('logs a line that fails at the build and one that fails at the write once each, without the resource body, on the new path', async () => {
        const request = await createTestRequest();
        useWritePath('new');
        await startImportAsync(request);
        const container = createImportContainer([
            fixtureWithId('patient', BUILD_THROWS_ID),
            fixture('observation'),
            fixtureWithId('patient', WRITE_THROWS_ID)
        ]);
        throwInBuildAndWriteForOneLineEach(container);
        mockLoggedCalls.length = 0;

        const recorded = await recordRangeAsync({ request, container, scope: SCOPE_ALL });

        const writeStepFailures = mockLoggedCalls
            .filter(([message]) => message === WRITE_STEP_FAILED_MESSAGE)
            .map(([, payload]) => payload);
        expect(writeStepFailures).toStrictEqual([
            {
                operation: 'import',
                step: 'buildDocument',
                stage: 'build',
                resourceType: 'Patient',
                id: BUILD_THROWS_ID,
                uuid: expect.any(String),
                sourceAssigningAuthority: 'client-a',
                originService: 'unknown',
                error: expect.objectContaining({ message: 'synthetic build failure' })
            },
            {
                operation: 'import',
                step: 'write',
                stage: 'write',
                resourceType: 'Patient',
                id: WRITE_THROWS_ID,
                uuid: expect.any(String),
                sourceAssigningAuthority: 'client-a',
                originService: 'unknown',
                error: expect.objectContaining({
                    message: expect.stringMatching(/^Error inserting: resource_uuid=/)
                })
            }
        ]);
        for (const payload of writeStepFailures) {
            expect(payload).not.toHaveProperty('name');
            expect(payload).not.toHaveProperty('family');
            expect(JSON.stringify(payload)).not.toContain('Importer');
            expect(Object.keys(payload.error).sort()).toStrictEqual([
                'message',
                'name',
                'stack',
                'statusCode'
            ]);
        }
        expect(recorded.errors.map(({ id }) => id)).toStrictEqual([
            BUILD_THROWS_ID,
            WRITE_THROWS_ID
        ]);
    });
});
