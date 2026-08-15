'use strict';

const { describe, test, expect, jest, beforeEach } = require('@jest/globals');

// Mock @opentelemetry/api before requiring the module under test
jest.mock('@opentelemetry/api', () => {
    const mockCounter = { add: jest.fn() };
    const mockHistogram = { record: jest.fn() };
    const mockMeter = {
        createCounter: jest.fn(() => mockCounter),
        createHistogram: jest.fn(() => mockHistogram)
    };
    return {
        metrics: {
            getMeter: jest.fn(() => mockMeter)
        },
        __mockCounter: mockCounter,
        __mockHistogram: mockHistogram
    };
});

const {
    tallyMergeOutcomes,
    worstSeverity,
    recordMergeOutcomes,
    recordValidationFailure,
    recordInboundBundleSize,
    recordOutboundEverything,
    recordKafkaRetryExhausted,
    recordImportOperationTriggered,
    recordImportResourceOutcomes,
    recordImportRangeDuration,
    recordImportS3ReadThroughput,
    recordImportFileSize,
    recordImportTaskCompleted,
    mergeOutcomeCounter,
    validationFailureCounter,
    bundleSizeHistogram,
    everythingEmptyCounter,
    kafkaRetryExhaustedCounter,
    importOperationsTriggeredCounter,
    importResourcesProcessedCounter,
    importResourcesFailedCounter,
    importRangeDurationHistogram,
    importS3ReadThroughputHistogram,
    importFileSizeHistogram,
    importTaskCompletedCounter,
    LABEL,
    OUTCOME,
    TASK_OUTCOME,
    VALIDATION_STAGE,
    DIRECTION,
    OPERATION,
    SUBSYSTEM,
    PATH,
    UNKNOWN
} = require('../../../utils/metrics');

describe('metrics.js', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('worstSeverity', () => {
        test('returns null for null input', () => {
            expect(worstSeverity(null)).toBeNull();
        });

        test('returns null for undefined input', () => {
            expect(worstSeverity(undefined)).toBeNull();
        });

        test('returns null for operationOutcome with no issues', () => {
            expect(worstSeverity({})).toBeNull();
        });

        test('returns null for operationOutcome with empty issue array', () => {
            expect(worstSeverity({ issue: [] })).toBeNull();
        });

        test('returns error for single error issue', () => {
            const oo = { issue: [{ severity: 'error' }] };
            expect(worstSeverity(oo)).toBe('error');
        });

        test('returns error when error is worst among multiple issues', () => {
            const oo = { issue: [{ severity: 'information' }, { severity: 'error' }, { severity: 'warning' }] };
            expect(worstSeverity(oo)).toBe('error');
        });

        test('returns warning when no errors present', () => {
            const oo = { issue: [{ severity: 'information' }, { severity: 'warning' }] };
            expect(worstSeverity(oo)).toBe('warning');
        });

        test('returns information when only information present', () => {
            const oo = { issue: [{ severity: 'information' }] };
            expect(worstSeverity(oo)).toBe('information');
        });

        test('handles non-array issue (single object)', () => {
            // The code wraps single issue in array: [operationOutcome.issue]
            const oo = { issue: { severity: 'warning' } };
            expect(worstSeverity(oo)).toBe('warning');
        });

        test('handles issue with null element', () => {
            const oo = { issue: [null, { severity: 'error' }] };
            expect(worstSeverity(oo)).toBe('error');
        });

        test('handles issue with missing severity property', () => {
            const oo = { issue: [{ code: 'invalid' }] };
            expect(worstSeverity(oo)).toBeNull();
        });

        test('handles unknown severity string', () => {
            const oo = { issue: [{ severity: 'fatal' }] };
            // 'fatal' is not in SEVERITY_RANK, so rank is 0
            expect(worstSeverity(oo)).toBeNull();
        });
    });

    describe('tallyMergeOutcomes', () => {
        test('returns empty map for null entries', () => {
            const result = tallyMergeOutcomes(null);
            expect(result.size).toBe(0);
        });

        test('returns empty map for empty entries', () => {
            const result = tallyMergeOutcomes([]);
            expect(result.size).toBe(0);
        });

        test('returns empty map for undefined entries', () => {
            const result = tallyMergeOutcomes(undefined);
            expect(result.size).toBe(0);
        });

        test('skips null entries in array', () => {
            const result = tallyMergeOutcomes([null, null]);
            expect(result.size).toBe(0);
        });

        test('skips OperationOutcome entries', () => {
            const result = tallyMergeOutcomes([
                { resourceType: 'OperationOutcome', issue: [{ severity: 'error' }] }
            ]);
            expect(result.size).toBe(0);
        });

        test('tallies created entries', () => {
            const result = tallyMergeOutcomes([
                { created: true, resourceType: 'Patient' },
                { created: true, resourceType: 'Patient' }
            ]);
            expect(result.get('created|Patient')).toBe(2);
        });

        test('tallies updated entries', () => {
            const result = tallyMergeOutcomes([
                { updated: true, resourceType: 'Observation' }
            ]);
            expect(result.get('updated|Observation')).toBe(1);
        });

        test('tallies error entries (has issue)', () => {
            const result = tallyMergeOutcomes([
                { issue: { severity: 'error' }, resourceType: 'Condition' }
            ]);
            expect(result.get('error|Condition')).toBe(1);
        });

        test('uses UNKNOWN for missing resourceType', () => {
            const result = tallyMergeOutcomes([
                { created: true }
            ]);
            expect(result.get('created|unknown')).toBe(1);
        });

        test('skips entries with no created/updated/issue', () => {
            const result = tallyMergeOutcomes([
                { resourceType: 'Patient' }  // no created, updated, or issue
            ]);
            expect(result.size).toBe(0);
        });

        test('created takes priority over updated', () => {
            // If both created and updated are true, 'created' is checked first
            const result = tallyMergeOutcomes([
                { created: true, updated: true, resourceType: 'Patient' }
            ]);
            expect(result.get('created|Patient')).toBe(1);
            expect(result.has('updated|Patient')).toBe(false);
        });

        test('updated takes priority over issue', () => {
            const result = tallyMergeOutcomes([
                { updated: true, issue: { severity: 'error' }, resourceType: 'Patient' }
            ]);
            expect(result.get('updated|Patient')).toBe(1);
            expect(result.has('error|Patient')).toBe(false);
        });

        test('mixed entries produce correct tallies', () => {
            const result = tallyMergeOutcomes([
                { created: true, resourceType: 'Patient' },
                { created: true, resourceType: 'Patient' },
                { updated: true, resourceType: 'Patient' },
                { issue: { severity: 'error' }, resourceType: 'Observation' },
                null,
                { resourceType: 'OperationOutcome', issue: {} },
                { resourceType: 'Condition' }  // skipped - no outcome flag
            ]);
            expect(result.get('created|Patient')).toBe(2);
            expect(result.get('updated|Patient')).toBe(1);
            expect(result.get('error|Observation')).toBe(1);
            expect(result.size).toBe(3);
        });
    });

    describe('recordMergeOutcomes', () => {
        test('emits counter for each tally bucket', () => {
            recordMergeOutcomes([
                { created: true, resourceType: 'Patient' },
                { created: true, resourceType: 'Patient' },
                { updated: true, resourceType: 'Observation' }
            ]);
            expect(mergeOutcomeCounter.add).toHaveBeenCalledTimes(2);
            expect(mergeOutcomeCounter.add).toHaveBeenCalledWith(2, {
                [LABEL.OUTCOME]: OUTCOME.CREATED,
                [LABEL.RESOURCE_TYPE]: 'Patient'
            });
            expect(mergeOutcomeCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.OUTCOME]: OUTCOME.UPDATED,
                [LABEL.RESOURCE_TYPE]: 'Observation'
            });
        });

        test('does not emit when entries is empty', () => {
            recordMergeOutcomes([]);
            expect(mergeOutcomeCounter.add).not.toHaveBeenCalled();
        });

        test('does not emit when entries is null', () => {
            recordMergeOutcomes(null);
            expect(mergeOutcomeCounter.add).not.toHaveBeenCalled();
        });
    });

    describe('recordValidationFailure', () => {
        test('emits counter when worst severity is error', () => {
            const oo = { issue: [{ severity: 'error' }] };
            recordValidationFailure(oo, 'Patient', VALIDATION_STAGE.SCHEMA, PATH.SAVE);
            expect(validationFailureCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.RESOURCE_TYPE]: 'Patient',
                [LABEL.VALIDATION_STAGE]: VALIDATION_STAGE.SCHEMA,
                [LABEL.SEVERITY]: 'error',
                [LABEL.PATH]: PATH.SAVE
            });
        });

        test('does not emit when worst severity is warning', () => {
            const oo = { issue: [{ severity: 'warning' }] };
            recordValidationFailure(oo, 'Patient', VALIDATION_STAGE.SCHEMA, PATH.SAVE);
            expect(validationFailureCounter.add).not.toHaveBeenCalled();
        });

        test('does not emit for null operationOutcome', () => {
            recordValidationFailure(null, 'Patient', VALIDATION_STAGE.SCHEMA, PATH.SAVE);
            expect(validationFailureCounter.add).not.toHaveBeenCalled();
        });

        test('uses UNKNOWN for null resourceType', () => {
            const oo = { issue: [{ severity: 'error' }] };
            recordValidationFailure(oo, null, VALIDATION_STAGE.META, PATH.VALIDATE);
            expect(validationFailureCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
                [LABEL.RESOURCE_TYPE]: UNKNOWN
            }));
        });

        test('defaults path to SAVE when not provided', () => {
            const oo = { issue: [{ severity: 'error' }] };
            recordValidationFailure(oo, 'Observation', VALIDATION_STAGE.REFERENCE, undefined);
            expect(validationFailureCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
                [LABEL.PATH]: PATH.SAVE
            }));
        });
    });

    describe('recordInboundBundleSize', () => {
        test('records histogram with direction inbound', () => {
            recordInboundBundleSize(OPERATION.MERGE, 42);
            expect(bundleSizeHistogram.record).toHaveBeenCalledWith(42, {
                [LABEL.DIRECTION]: DIRECTION.INBOUND,
                [LABEL.OPERATION]: OPERATION.MERGE
            });
        });

        test('uses UNKNOWN for null operation', () => {
            recordInboundBundleSize(null, 10);
            expect(bundleSizeHistogram.record).toHaveBeenCalledWith(10, {
                [LABEL.DIRECTION]: DIRECTION.INBOUND,
                [LABEL.OPERATION]: UNKNOWN
            });
        });
    });

    describe('recordOutboundEverything', () => {
        test('records histogram with direction outbound', () => {
            recordOutboundEverything('Patient', 5);
            expect(bundleSizeHistogram.record).toHaveBeenCalledWith(5, {
                [LABEL.DIRECTION]: DIRECTION.OUTBOUND,
                [LABEL.OPERATION]: OPERATION.EVERYTHING,
                [LABEL.RESOURCE_TYPE]: 'Patient'
            });
        });

        test('emits empty counter when entryCount is 0', () => {
            recordOutboundEverything('Patient', 0);
            expect(everythingEmptyCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.RESOURCE_TYPE]: 'Patient'
            });
        });

        test('does not emit empty counter when entryCount > 0', () => {
            recordOutboundEverything('Patient', 1);
            expect(everythingEmptyCounter.add).not.toHaveBeenCalled();
        });

        test('uses UNKNOWN for null resourceType', () => {
            recordOutboundEverything(null, 0);
            expect(bundleSizeHistogram.record).toHaveBeenCalledWith(0, expect.objectContaining({
                [LABEL.RESOURCE_TYPE]: UNKNOWN
            }));
            expect(everythingEmptyCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.RESOURCE_TYPE]: UNKNOWN
            });
        });
    });

    describe('recordKafkaRetryExhausted', () => {
        test('emits counter with topic and error code', () => {
            recordKafkaRetryExhausted('my-topic', 'ECONNREFUSED');
            expect(kafkaRetryExhaustedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.TOPIC]: 'my-topic',
                [LABEL.ERROR_CODE]: 'ECONNREFUSED',
                [LABEL.SUBSYSTEM]: SUBSYSTEM.KAFKA
            });
        });

        test('uses UNKNOWN for null topic', () => {
            recordKafkaRetryExhausted(null, 'ERR');
            expect(kafkaRetryExhaustedCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
                [LABEL.TOPIC]: UNKNOWN
            }));
        });

        test('uses UNKNOWN for null error code', () => {
            recordKafkaRetryExhausted('topic', null);
            expect(kafkaRetryExhaustedCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
                [LABEL.ERROR_CODE]: UNKNOWN
            }));
        });

        test('uses UNKNOWN for undefined error code', () => {
            recordKafkaRetryExhausted('topic', undefined);
            expect(kafkaRetryExhaustedCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
                [LABEL.ERROR_CODE]: UNKNOWN
            }));
        });

        test('converts numeric error code to string', () => {
            recordKafkaRetryExhausted('topic', 500);
            expect(kafkaRetryExhaustedCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
                [LABEL.ERROR_CODE]: '500'
            }));
        });

        test('converts 0 error code to string "0" (not UNKNOWN)', () => {
            // errorCode != null check: 0 != null is true, so it converts to "0"
            recordKafkaRetryExhausted('topic', 0);
            expect(kafkaRetryExhaustedCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
                [LABEL.ERROR_CODE]: '0'
            }));
        });
    });

    describe('recordImportOperationTriggered', () => {
        test('emits counter with no labels', () => {
            recordImportOperationTriggered();
            expect(importOperationsTriggeredCounter.add).toHaveBeenCalledWith(1);
        });

        test('emits once per call', () => {
            recordImportOperationTriggered();
            recordImportOperationTriggered();
            expect(importOperationsTriggeredCounter.add).toHaveBeenCalledTimes(2);
        });
    });

    describe('recordImportTaskCompleted', () => {
        test('emits counter with the outcome label', () => {
            recordImportTaskCompleted(TASK_OUTCOME.SUCCESS);
            expect(importTaskCompletedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.OUTCOME]: TASK_OUTCOME.SUCCESS
            });
        });

        test('emits once per call, one call per outcome', () => {
            recordImportTaskCompleted(TASK_OUTCOME.FAILED);
            recordImportTaskCompleted(TASK_OUTCOME.PARTIAL_FAILURE);
            expect(importTaskCompletedCounter.add).toHaveBeenCalledTimes(2);
            expect(importTaskCompletedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.OUTCOME]: TASK_OUTCOME.FAILED
            });
            expect(importTaskCompletedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.OUTCOME]: TASK_OUTCOME.PARTIAL_FAILURE
            });
        });
    });

    describe('recordImportResourceOutcomes', () => {
        test('routes created/updated tallies to the processed counter, by outcome and resource_type', () => {
            recordImportResourceOutcomes([
                { created: true, resourceType: 'Patient' },
                { created: true, resourceType: 'Patient' },
                { updated: true, resourceType: 'Observation' }
            ]);
            expect(importResourcesProcessedCounter.add).toHaveBeenCalledTimes(2);
            expect(importResourcesProcessedCounter.add).toHaveBeenCalledWith(2, {
                [LABEL.OUTCOME]: OUTCOME.CREATED,
                [LABEL.RESOURCE_TYPE]: 'Patient'
            });
            expect(importResourcesProcessedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.OUTCOME]: OUTCOME.UPDATED,
                [LABEL.RESOURCE_TYPE]: 'Observation'
            });
        });

        test('routes error tallies to the failed counter, by resource_type only', () => {
            recordImportResourceOutcomes([
                { issue: { severity: 'error' }, resourceType: 'Condition' },
                { issue: { severity: 'error' }, resourceType: 'Condition' }
            ]);
            expect(importResourcesFailedCounter.add).toHaveBeenCalledTimes(1);
            expect(importResourcesFailedCounter.add).toHaveBeenCalledWith(2, {
                [LABEL.RESOURCE_TYPE]: 'Condition'
            });
        });

        test('sanitizes an unbounded/invalid resourceType (e.g. a bad NDJSON line) to UNKNOWN before it becomes a label', () => {
            recordImportResourceOutcomes([
                { issue: { severity: 'error' }, resourceType: 'not a real resource type; totally free text' }
            ]);
            expect(importResourcesFailedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.RESOURCE_TYPE]: UNKNOWN
            });
        });

        test('passes through a real FHIR resourceType unchanged', () => {
            recordImportResourceOutcomes([
                { created: true, resourceType: 'Patient' }
            ]);
            expect(importResourcesProcessedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.OUTCOME]: OUTCOME.CREATED,
                [LABEL.RESOURCE_TYPE]: 'Patient'
            });
        });

        test('sanitizes to UNKNOWN on the processed (created/updated) path too, not just failed', () => {
            recordImportResourceOutcomes([
                { created: true, resourceType: 'TotallyBogusType' }
            ]);
            expect(importResourcesProcessedCounter.add).toHaveBeenCalledWith(1, {
                [LABEL.OUTCOME]: OUTCOME.CREATED,
                [LABEL.RESOURCE_TYPE]: UNKNOWN
            });
        });

        test('does not emit for entries with no outcome (e.g. skipped ifNoneExist matches)', () => {
            recordImportResourceOutcomes([
                { created: false, updated: false, issue: null, resourceType: 'Patient' }
            ]);
            expect(importResourcesProcessedCounter.add).not.toHaveBeenCalled();
            expect(importResourcesFailedCounter.add).not.toHaveBeenCalled();
        });

        test('does not emit for empty or null entries', () => {
            recordImportResourceOutcomes([]);
            recordImportResourceOutcomes(null);
            expect(importResourcesProcessedCounter.add).not.toHaveBeenCalled();
            expect(importResourcesFailedCounter.add).not.toHaveBeenCalled();
        });
    });

    describe('recordImportRangeDuration', () => {
        test('records the histogram with the given duration', () => {
            recordImportRangeDuration(12.5);
            expect(importRangeDurationHistogram.record).toHaveBeenCalledWith(12.5);
        });
    });

    describe('recordImportS3ReadThroughput', () => {
        test('records bytes-per-second when duration is positive', () => {
            recordImportS3ReadThroughput(1000, 2);
            expect(importS3ReadThroughputHistogram.record).toHaveBeenCalledWith(500);
        });

        test('does not record when duration is zero', () => {
            recordImportS3ReadThroughput(1000, 0);
            expect(importS3ReadThroughputHistogram.record).not.toHaveBeenCalled();
        });

        test('does not record when duration is negative', () => {
            recordImportS3ReadThroughput(1000, -1);
            expect(importS3ReadThroughputHistogram.record).not.toHaveBeenCalled();
        });
    });

    describe('recordImportFileSize', () => {
        test('records the histogram with the given file size', () => {
            recordImportFileSize(2048);
            expect(importFileSizeHistogram.record).toHaveBeenCalledWith(2048);
        });
    });

    describe('label constants are frozen', () => {
        test('LABEL is frozen', () => {
            expect(Object.isFrozen(LABEL)).toBe(true);
        });

        test('OUTCOME is frozen', () => {
            expect(Object.isFrozen(OUTCOME)).toBe(true);
        });

        test('TASK_OUTCOME is frozen', () => {
            expect(Object.isFrozen(TASK_OUTCOME)).toBe(true);
        });

        test('VALIDATION_STAGE is frozen', () => {
            expect(Object.isFrozen(VALIDATION_STAGE)).toBe(true);
        });

        test('DIRECTION is frozen', () => {
            expect(Object.isFrozen(DIRECTION)).toBe(true);
        });
    });
});
