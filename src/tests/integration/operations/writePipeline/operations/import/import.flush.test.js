const path = require('path');
const { describe, test, expect, jest } = require('@jest/globals');
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
            expectedNew: 'difference 4: nothing of the batch whose flush throws is counted or audited',
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
            expectedNew: 'difference 4: nothing of the batch whose flush throws is counted or audited, not even its line that failed a check',
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
            name: 'handles an unexpected error thrown by the meta check of one line',
            expectedNew: 'difference 4: an unexpected error thrown by a check of one line fails the batch and the range',
            prepare: throwInMetaCheckForOneLine,
            rangeFailureMessages: { old: [], new: ['unexpected meta check failure'] },
            lines: [
                fixture('patient'),
                fixtureWithId('patient', CHECK_THROWS_ID),
                fixture('observation')
            ]
        }
    ];

    test.each(withEachPath(cases))('$name on the $writePath path', async ({
        key,
        writePath,
        expectedNew,
        lines,
        env = {},
        prepare = () => {},
        rangeFailureMessages
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
    });
});
