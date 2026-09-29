'use strict';

const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../utils/convertErrorToOperationOutcome', () => ({
    convertErrorToOperationOutcome: jestObj.fn().mockReturnValue({ resourceType: 'OperationOutcome' })
}));

jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

jestObj.mock('../../../../../utils/getCircularReplacer', () => ({
    getCircularReplacer: jestObj.fn().mockReturnValue(undefined)
}));

jestObj.mock('../../../../../operations/common/sentry', () => ({
    captureException: jestObj.fn()
}));

jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jestObj.fn()
    }
}));

jestObj.mock('../../../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

const { ObjectSerializedFhirResourceNdJsonWriter } = require('../../../../../operations/streaming/resourceWriters/objectSerializedFhirResourceNdJsonWriter');
const { convertErrorToOperationOutcome } = require('../../../../../utils/convertErrorToOperationOutcome');
const { captureException } = require('../../../../../operations/common/sentry');

describe('ObjectSerializedFhirResourceNdJsonWriter', () => {
    let writer;
    let mockSignal;
    let mockConfigManager;
    let pushSpy;
    let writeOperationOutcomeSpy;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockSignal = { aborted: false };
        mockConfigManager = { logStreamSteps: false };

        writer = new ObjectSerializedFhirResourceNdJsonWriter({
            signal: mockSignal,
            contentType: 'application/fhir+ndjson',
            highWaterMark: 16,
            configManager: mockConfigManager,
            response: {}
        });

        // Spy on push (inherited from Transform)
        pushSpy = jestObj.spyOn(writer, 'push').mockReturnValue(true);
        writeOperationOutcomeSpy = jestObj.fn();
        writer.writeOperationOutcome = writeOperationOutcomeSpy;
    });

    describe('_transform', () => {
        test('pushes JSON + newline for valid chunk', (done) => {
            const chunk = {
                id: 'patient-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'patient-1' })
            };

            writer._transform(chunk, 'utf8', () => {
                expect(pushSpy).toHaveBeenCalledWith(
                    '{"resourceType":"Patient","id":"patient-1"}\n',
                    'utf8'
                );
                done();
            });
        });

        test('calls toJSON on the chunk before stringifying', (done) => {
            const toJSONSpy = jestObj.fn().mockReturnValue({ id: 'test-123' });
            const chunk = { id: 'test-123', toJSON: toJSONSpy };

            writer._transform(chunk, 'utf8', () => {
                expect(toJSONSpy).toHaveBeenCalled();
                expect(pushSpy).toHaveBeenCalledWith(
                    '{"id":"test-123"}\n',
                    'utf8'
                );
                done();
            });
        });

        test('handles error in toJSON gracefully', (done) => {
            const chunk = {
                id: 'error-chunk',
                toJSON: () => { throw new Error('toJSON failed'); }
            };

            writer._transform(chunk, 'utf8', () => {
                expect(pushSpy).not.toHaveBeenCalled();
                expect(captureException).toHaveBeenCalled();
                expect(convertErrorToOperationOutcome).toHaveBeenCalled();
                expect(writeOperationOutcomeSpy).toHaveBeenCalled();
                done();
            });
        });

        test('respects signal.aborted - does nothing when aborted', (done) => {
            mockSignal.aborted = true;
            const chunk = {
                id: 'patient-1',
                toJSON: () => ({ resourceType: 'Patient', id: 'patient-1' })
            };

            writer._transform(chunk, 'utf8', () => {
                expect(pushSpy).not.toHaveBeenCalled();
                done();
            });
        });

        test('does not push when chunk is null', (done) => {
            writer._transform(null, 'utf8', () => {
                expect(pushSpy).not.toHaveBeenCalled();
                done();
            });
        });

        test('logs when configManager.logStreamSteps is true', (done) => {
            mockConfigManager.logStreamSteps = true;
            const { logInfo } = require('../../../../../operations/common/logging');

            const chunk = {
                id: 'log-test',
                toJSON: () => ({ id: 'log-test' })
            };

            writer._transform(chunk, 'utf8', () => {
                expect(logInfo).toHaveBeenCalledWith(
                    'ObjectSerializedFhirResourceNdJsonWriter: _transform log-test',
                    {}
                );
                done();
            });
        });

        test('always invokes callback even on error', (done) => {
            const chunk = {
                id: 'callback-test',
                toJSON: () => { throw new Error('fail'); }
            };

            writer._transform(chunk, 'utf8', () => {
                // If we get here, callback was invoked
                expect(true).toBe(true);
                done();
            });
        });
    });
});
