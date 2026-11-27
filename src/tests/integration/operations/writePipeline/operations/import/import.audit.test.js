const mockImportMetricCalls = [];

const { describe, test, jest } = require('@jest/globals');

jest.mock('../../../../../../utils/metrics', () => {
    const actual = jest.requireActual('../../../../../../utils/metrics');
    return {
        ...actual,
        recordImportResourceOutcomes: (entries) => {
            mockImportMetricCalls.push({
                name: 'recordImportResourceOutcomes',
                outcomes: entries.map(({ resourceType, created, updated, issue }) => ({
                    resourceType,
                    created,
                    updated,
                    failed: Boolean(issue)
                }))
            });
            return actual.recordImportResourceOutcomes(entries);
        },
        recordImportRanges: (outcome, count) => {
            mockImportMetricCalls.push({ name: 'recordImportRanges', outcome, count: count ?? null });
            return actual.recordImportRanges(outcome, count);
        },
        recordImportRangeDuration: (durationSeconds) => {
            mockImportMetricCalls.push({
                name: 'recordImportRangeDuration',
                isNonNegativeNumber: typeof durationSeconds === 'number' && durationSeconds >= 0
            });
            return actual.recordImportRangeDuration(durationSeconds);
        }
    };
});

const path = require('path');
const { createTestRequest } = require('../../../../common');
const {
    EXPECTED_DIRECTORY,
    SCOPE_ALL,
    registerImportTestHooks,
    fixture,
    fixtureWithId,
    useWritePath,
    withEachPath,
    expectedFileOf,
    writesExpectedFile,
    expectMatchesExpectedFile,
    seedAsync,
    startImportAsync,
    createImportContainer,
    recordRangeAsync
} = require('./importTestSetup');

const AUDIT_EXPECTED_DIRECTORY = path.join(EXPECTED_DIRECTORY, 'audit');

/**
 * Returns the parts of a change-event message the worker's range decides: its key, action, event
 * name and the resource it names. The message's own id, dates and request id are left out.
 */
const changeEventMessageOf = ({ key, value }) => {
    const event = JSON.parse(value);
    return {
        key,
        action: event.action,
        eventName: event.purposeOfEvent?.[0]?.coding?.[0]?.code,
        who: event.agent?.[0]?.who?.reference
    };
};

/**
 * Orders values by their serialized form so a run does not depend on the order of parallel work.
 */
const sortedBySerialized = (values) =>
    [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/**
 * Runs one range through a new worker container and records what the range emits besides its
 * output files and documents, which `import.test.js` pins: every change event the bulk inserter
 * hands to the post-save processor (type, resource and context data per written document), the
 * change-event messages sent to Kafka, and the import metrics, in call order.
 */
const recordEmittedAsync = async ({ request, lines }) => {
    await startImportAsync(request);
    const container = createImportContainer(lines);
    const postSaveSpy = jest.spyOn(container.postSaveProcessor, 'afterSaveAsync');
    mockImportMetricCalls.length = 0;

    const { result } = await recordRangeAsync({ request, container, scope: SCOPE_ALL });
    await container.changeEventProducer.flushAsync();

    return JSON.parse(JSON.stringify({
        result: result.map(({ resourceType, id, created, updated, issue }) => ({
            resourceType,
            id,
            created,
            updated,
            failed: Boolean(issue)
        })),
        changeEvents: sortedBySerialized(
            postSaveSpy.mock.calls.map(([{ eventType, resourceType, doc, contextData }]) => ({
                eventType,
                resourceType,
                id: doc.id,
                uuid: doc._uuid,
                contextData
            }))
        ),
        kafkaMessages: sortedBySerialized(container.kafkaClient.getMessages().map(changeEventMessageOf)),
        metrics: [...mockImportMetricCalls]
    }));
};

describe('$import change events and import metrics on the old and the new write path', () => {
    registerImportTestHooks();

    /**
     * Each case has a stable `key`, which names its expected file under `expected/audit`, the
     * resources to `previous`ly store and the NDJSON `lines`. A case that differs on the new path
     * sets `expectedNew` to the row of the plan's differences that it shows.
     */
    const cases = [
        {
            key: 'mixedBatch',
            name: 'emits change events and import metrics for a batch with created, updated, unchanged, failed and skipped lines and an AuditEvent',
            expectedNew: 'difference 2: an unchanged line is reported neither created nor updated, so the import metrics do not count it',
            previous: [fixture('patient'), fixture('observation'), fixture('patientWithIdentifier')],
            lines: [
                fixture('patientUpdated'),
                fixture('observation'),
                fixtureWithId('patient', 'import-audit-new'),
                fixture('patientTwoOwnerTags'),
                fixture('ifNoneExistPatient'),
                fixture('auditEvent')
            ]
        },
        {
            key: 'sameBatchDuplicate',
            name: 'emits one create event for two lines of one new resource in a batch',
            previous: [],
            lines: [fixture('patientPartOne'), fixture('patientPartTwo')]
        },
        {
            key: 'group',
            name: 'emits a create event with the context data of a Group',
            previous: [],
            lines: [fixture('group')]
        }
    ];

    test.each(withEachPath(cases))('$name on the $writePath path', async ({
        key,
        writePath,
        expectedNew,
        previous,
        lines
    }) => {
        const request = await createTestRequest();
        await seedAsync(request, previous);
        process.env.KAFKA_ENABLED_RESOURCES = 'Patient,Observation,Group,AuditEvent';
        useWritePath(writePath);

        const recorded = await recordEmittedAsync({ request, lines });

        expectMatchesExpectedFile({
            recorded,
            file: expectedFileOf({ directory: AUDIT_EXPECTED_DIRECTORY, key, expectedNew, writePath }),
            write: writesExpectedFile({ expectedNew, writePath })
        });
    });
});
