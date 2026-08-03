const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../../../operations/common/sentry', () => ({
    captureException: jestObj.fn()
}));

jestObj.mock('../../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jestObj.fn((obj) => obj)
    }
}));

jestObj.mock('../../../../../operations/common/logging', () => ({
    logInfo: jestObj.fn(),
    logError: jestObj.fn()
}));

jestObj.mock('../../../../../utils/convertErrorToOperationOutcome', () => ({
    convertErrorToOperationOutcome: jestObj.fn(({ error }) => ({
        toJSON: () => ({
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', diagnostics: error.message }]
        })
    }))
}));

const { FhirResourceWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceWriter');
const { ConfigManager } = require('../../../../../utils/configManager');
const { captureException } = require('../../../../../operations/common/sentry');
const { logInfo, logError } = require('../../../../../operations/common/logging');
const { FhirResourceSerializer } = require('../../../../../fhir/fhirResourceSerializer');
const { convertErrorToOperationOutcome } = require('../../../../../utils/convertErrorToOperationOutcome');

function createMockConfigManager(logStreamSteps = false) {
    const instance = Object.create(ConfigManager.prototype);
    Object.defineProperty(instance, 'logStreamSteps', {
        get: () => logStreamSteps,
        configurable: true
    });
    return instance;
}

describe('FhirResourceWriter', () => {
    let writer;
    let mockConfigManager;
    let mockResponse;
    let mockSignal;

    beforeEach(() => {
        jestObj.clearAllMocks();
        // Reset serialize to default implementation since clearAllMocks does not reset mockImplementation
        FhirResourceSerializer.serialize.mockImplementation((obj) => obj);

        mockConfigManager = createMockConfigManager(false);
        mockResponse = {
            statusCode: 200,
            write: jestObj.fn(),
            end: jestObj.fn()
        };
        mockSignal = { aborted: false };

        writer = new FhirResourceWriter({
            signal: mockSignal,
            contentType: 'application/json',
            highWaterMark: 100,
            configManager: mockConfigManager,
            response: mockResponse
        });
    });

    describe('constructor', () => {
        test('initializes _first to true', () => {
            expect(writer._first).toBe(true);
        });

        test('stores signal reference', () => {
            expect(writer._signal).toBe(mockSignal);
        });

        test('stores configManager', () => {
            expect(writer.configManager).toBe(mockConfigManager);
        });

        test('calls assertTypeEquals for configManager', () => {
            const { assertTypeEquals } = require('../../../../../utils/assertType');
            expect(assertTypeEquals).toHaveBeenCalledWith(mockConfigManager, ConfigManager);
        });

        test('sets content type via parent class', () => {
            expect(writer.getContentType()).toBe('application/json');
        });
    });

    describe('_transform', () => {
        test('pushes first chunk with opening bracket', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk = { id: 'test-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(pushSpy).toHaveBeenCalledWith(
                    expect.stringMatching(/^\[/),
                    'utf8'
                );
                expect(writer._first).toBe(false);
                done();
            });
        });

        test('pushes subsequent chunks with leading comma', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk1 = { id: 'test-1', resourceType: 'Patient' };
            const chunk2 = { id: 'test-2', resourceType: 'Patient' };

            writer._transform(chunk1, 'utf8', () => {
                pushSpy.mockClear();
                writer._transform(chunk2, 'utf8', () => {
                    expect(pushSpy).toHaveBeenCalledWith(
                        expect.stringMatching(/^,/),
                        'utf8'
                    );
                    done();
                });
            });
        });

        test('serializes the chunk with FhirResourceSerializer', (done) => {
            const chunk = { id: 'test-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(chunk);
                done();
            });
        });

        test('uses JSON.stringify with circular replacer', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk = { id: 'test-1', resourceType: 'Patient', name: 'John' };

            writer._transform(chunk, 'utf8', () => {
                const pushed = pushSpy.mock.calls[0][0];
                // First push starts with '[' followed by JSON
                const jsonPart = pushed.substring(1);
                const parsed = JSON.parse(jsonPart);
                expect(parsed.id).toBe('test-1');
                expect(parsed.resourceType).toBe('Patient');
                expect(parsed.name).toBe('John');
                done();
            });
        });

        test('does nothing when signal is aborted', (done) => {
            mockSignal.aborted = true;
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk = { id: 'test-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(pushSpy).not.toHaveBeenCalled();
                done();
            });
        });

        test('does nothing when chunk is null', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');

            writer._transform(null, 'utf8', () => {
                expect(pushSpy).not.toHaveBeenCalled();
                done();
            });
        });

        test('does nothing when chunk is undefined', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');

            writer._transform(undefined, 'utf8', () => {
                expect(pushSpy).not.toHaveBeenCalled();
                done();
            });
        });

        test('logs info when logStreamSteps is enabled', (done) => {
            const loggingConfigManager = createMockConfigManager(true);
            const loggingWriter = new FhirResourceWriter({
                signal: mockSignal,
                contentType: 'application/json',
                highWaterMark: 100,
                configManager: loggingConfigManager,
                response: mockResponse
            });

            const chunk = { id: 'resource-42', resourceType: 'Observation' };

            loggingWriter._transform(chunk, 'utf8', () => {
                expect(logInfo).toHaveBeenCalledWith(
                    expect.stringContaining('resource-42'),
                    expect.anything()
                );
                done();
            });
        });

        test('does not log when logStreamSteps is disabled', (done) => {
            const chunk = { id: 'test-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(logInfo).not.toHaveBeenCalled();
                done();
            });
        });

        test('handles serialization error by writing OperationOutcome', (done) => {
            FhirResourceSerializer.serialize.mockImplementation(() => {
                throw new Error('serialization failed');
            });

            const writeOpOutcomeSpy = jestObj.spyOn(writer, 'writeOperationOutcome');
            const chunk = { id: 'bad-resource', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(logError).toHaveBeenCalled();
                expect(captureException).toHaveBeenCalled();
                expect(convertErrorToOperationOutcome).toHaveBeenCalled();
                expect(writeOpOutcomeSpy).toHaveBeenCalled();
                done();
            });
        });

        test('error handler does not propagate exception', (done) => {
            FhirResourceSerializer.serialize.mockImplementation(() => {
                throw new Error('unexpected');
            });

            // callback should still be called (no error passed)
            writer._transform({ id: '1' }, 'utf8', (err) => {
                expect(err).toBeUndefined();
                done();
            });
        });

        test('always calls callback even after error', (done) => {
            FhirResourceSerializer.serialize.mockImplementation(() => {
                throw new Error('oops');
            });

            const callbackFn = jestObj.fn();
            writer._transform({ id: '1' }, 'utf8', callbackFn);

            // Use setImmediate to allow microtask to complete
            setImmediate(() => {
                expect(callbackFn).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('_flush', () => {
        test('pushes closing bracket and null when items were written', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            // Simulate having written at least one item
            writer._first = false;

            writer._flush(() => {
                expect(pushSpy).toHaveBeenCalledWith(']');
                expect(pushSpy).toHaveBeenCalledWith(null);
                done();
            });
        });

        test('pushes empty array brackets when no items were written', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');

            writer._flush(() => {
                // When _first is true, it pushes '[' then ']' then null
                expect(pushSpy).toHaveBeenCalledWith('[');
                expect(pushSpy).toHaveBeenCalledWith(']');
                expect(pushSpy).toHaveBeenCalledWith(null);
                done();
            });
        });

        test('sets _first to false during flush of empty stream', (done) => {
            writer._flush(() => {
                expect(writer._first).toBe(false);
                done();
            });
        });

        test('does nothing when signal is aborted', (done) => {
            mockSignal.aborted = true;
            const pushSpy = jestObj.spyOn(writer, 'push');

            writer._flush(() => {
                expect(pushSpy).not.toHaveBeenCalled();
                done();
            });
        });

        test('logs when logStreamSteps is enabled', (done) => {
            const loggingConfigManager = createMockConfigManager(true);
            const loggingWriter = new FhirResourceWriter({
                signal: mockSignal,
                contentType: 'application/json',
                highWaterMark: 100,
                configManager: loggingConfigManager,
                response: mockResponse
            });
            loggingWriter._first = false;

            loggingWriter._flush(() => {
                expect(logInfo).toHaveBeenCalledWith(
                    expect.stringContaining('_flush'),
                    expect.anything()
                );
                done();
            });
        });
    });

    describe('writeOperationOutcome', () => {
        test('first OperationOutcome sets status 500 and starts array', () => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome', issue: [] })
            };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            expect(mockResponse.statusCode).toBe(500);
            expect(writer._first).toBe(false);
            const pushed = pushSpy.mock.calls[0][0];
            expect(pushed).toMatch(/^\[/);
            expect(pushed).toContain('OperationOutcome');
        });

        test('subsequent OperationOutcome adds comma prefix', () => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            writer._first = false;

            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome', issue: [{ severity: 'error' }] })
            };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            const pushed = pushSpy.mock.calls[0][0];
            expect(pushed).toMatch(/^,/);
            expect(pushed).toContain('OperationOutcome');
            // Status code should not be set when not first
            expect(mockResponse.statusCode).toBe(200);
        });

        test('serializes OperationOutcome using toJSON', () => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const outcomeData = {
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', code: 'internal', diagnostics: 'test error' }]
            };
            const operationOutcome = { toJSON: () => outcomeData };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            const pushed = pushSpy.mock.calls[0][0];
            const jsonPart = pushed.substring(1); // remove leading '[' or ','
            const parsed = JSON.parse(jsonPart);
            expect(parsed).toEqual(outcomeData);
        });

        test('passes encoding to push', () => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome' })
            };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            expect(pushSpy).toHaveBeenCalledWith(expect.any(String), 'utf8');
        });
    });

    describe('integration scenarios', () => {
        test('full stream lifecycle: multiple chunks then flush produces valid JSON', (done) => {
            const chunks = [];
            jestObj.spyOn(writer, 'push').mockImplementation((data) => {
                if (data !== null) {
                    chunks.push(data);
                }
                return true;
            });

            const resources = [
                { id: '1', resourceType: 'Patient' },
                { id: '2', resourceType: 'Patient' },
                { id: '3', resourceType: 'Patient' }
            ];

            let idx = 0;
            const processNext = () => {
                if (idx < resources.length) {
                    writer._transform(resources[idx], 'utf8', () => {
                        idx++;
                        processNext();
                    });
                } else {
                    writer._flush(() => {
                        const fullJson = chunks.join('');
                        const parsed = JSON.parse(fullJson);
                        expect(parsed).toHaveLength(3);
                        expect(parsed[0].id).toBe('1');
                        expect(parsed[1].id).toBe('2');
                        expect(parsed[2].id).toBe('3');
                        done();
                    });
                }
            };
            processNext();
        });

        test('empty stream produces empty array', (done) => {
            const chunks = [];
            jestObj.spyOn(writer, 'push').mockImplementation((data) => {
                if (data !== null) {
                    chunks.push(data);
                }
                return true;
            });

            writer._flush(() => {
                const fullJson = chunks.join('');
                const parsed = JSON.parse(fullJson);
                expect(parsed).toEqual([]);
                done();
            });
        });
    });
});
