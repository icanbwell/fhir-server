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

const { FhirResourceNdJsonWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceNdJsonWriter');
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

describe('FhirResourceNdJsonWriter', () => {
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

        writer = new FhirResourceNdJsonWriter({
            signal: mockSignal,
            contentType: 'application/ndjson',
            highWaterMark: 100,
            configManager: mockConfigManager,
            response: mockResponse
        });
    });

    describe('constructor', () => {
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
            expect(writer.getContentType()).toBe('application/ndjson');
        });
    });

    describe('_transform', () => {
        test('pushes chunk as JSON followed by newline', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk = { id: 'test-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                const pushed = pushSpy.mock.calls[0][0];
                expect(pushed).toMatch(/\n$/);
                const parsed = JSON.parse(pushed.trim());
                expect(parsed.id).toBe('test-1');
                expect(parsed.resourceType).toBe('Patient');
                done();
            });
        });

        test('each chunk gets its own newline-terminated line', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk1 = { id: '1', resourceType: 'Patient' };
            const chunk2 = { id: '2', resourceType: 'Observation' };

            writer._transform(chunk1, 'utf8', () => {
                writer._transform(chunk2, 'utf8', () => {
                    expect(pushSpy).toHaveBeenCalledTimes(2);
                    const line1 = pushSpy.mock.calls[0][0];
                    const line2 = pushSpy.mock.calls[1][0];
                    expect(line1).toMatch(/\n$/);
                    expect(line2).toMatch(/\n$/);
                    expect(JSON.parse(line1.trim()).id).toBe('1');
                    expect(JSON.parse(line2.trim()).id).toBe('2');
                    done();
                });
            });
        });

        test('does not use comma separators (unlike JSON writer)', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk1 = { id: '1', resourceType: 'Patient' };
            const chunk2 = { id: '2', resourceType: 'Patient' };

            writer._transform(chunk1, 'utf8', () => {
                writer._transform(chunk2, 'utf8', () => {
                    const line2 = pushSpy.mock.calls[1][0];
                    expect(line2).not.toMatch(/^,/);
                    done();
                });
            });
        });

        test('does not use array brackets (unlike JSON writer)', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk = { id: '1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                const pushed = pushSpy.mock.calls[0][0];
                expect(pushed).not.toMatch(/^\[/);
                done();
            });
        });

        test('serializes the chunk with FhirResourceSerializer', (done) => {
            const chunk = { id: 'test-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(chunk);
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
            const loggingWriter = new FhirResourceNdJsonWriter({
                signal: mockSignal,
                contentType: 'application/ndjson',
                highWaterMark: 100,
                configManager: loggingConfigManager,
                response: mockResponse
            });

            const chunk = { id: 'resource-99', resourceType: 'Condition' };

            loggingWriter._transform(chunk, 'utf8', () => {
                expect(logInfo).toHaveBeenCalledWith(
                    expect.stringContaining('resource-99'),
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

            setImmediate(() => {
                expect(callbackFn).toHaveBeenCalled();
                done();
            });
        });

        test('passes encoding to push', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk = { id: '1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(pushSpy).toHaveBeenCalledWith(expect.any(String), 'utf8');
                done();
            });
        });

        test('handles circular references via getCircularReplacer', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const chunk = { id: '1', resourceType: 'Patient' };
            chunk.self = chunk; // create circular reference

            writer._transform(chunk, 'utf8', () => {
                // Should not throw, should handle gracefully
                const pushed = pushSpy.mock.calls[0][0];
                expect(pushed).toMatch(/\n$/);
                // Circular reference should be excluded
                const parsed = JSON.parse(pushed.trim());
                expect(parsed.id).toBe('1');
                expect(parsed.self).toBeUndefined();
                done();
            });
        });
    });

    describe('_flush', () => {
        test('pushes null to signal end of stream', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');

            writer._flush(() => {
                expect(pushSpy).toHaveBeenCalledWith(null);
                done();
            });
        });

        test('does not push any brackets or closing characters', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');

            writer._flush(() => {
                // Only called once with null
                expect(pushSpy).toHaveBeenCalledTimes(1);
                expect(pushSpy).toHaveBeenCalledWith(null);
                done();
            });
        });

        test('logs when logStreamSteps is enabled', (done) => {
            const loggingConfigManager = createMockConfigManager(true);
            const loggingWriter = new FhirResourceNdJsonWriter({
                signal: mockSignal,
                contentType: 'application/ndjson',
                highWaterMark: 100,
                configManager: loggingConfigManager,
                response: mockResponse
            });

            loggingWriter._flush(() => {
                expect(logInfo).toHaveBeenCalledWith(
                    expect.stringContaining('_flush'),
                    expect.anything()
                );
                done();
            });
        });

        test('does not log when logStreamSteps is disabled', (done) => {
            writer._flush(() => {
                expect(logInfo).not.toHaveBeenCalled();
                done();
            });
        });

        test('does not check abort signal (unlike JSON writer)', (done) => {
            mockSignal.aborted = true;
            const pushSpy = jestObj.spyOn(writer, 'push');

            writer._flush(() => {
                // NDJSON flush still pushes null even if aborted
                expect(pushSpy).toHaveBeenCalledWith(null);
                done();
            });
        });
    });

    describe('writeOperationOutcome', () => {
        test('sets status code to 500', () => {
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome', issue: [] })
            };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            expect(mockResponse.statusCode).toBe(500);
        });

        test('pushes OperationOutcome as NDJSON line', () => {
            const pushSpy = jestObj.spyOn(writer, 'push');
            const outcomeData = {
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', diagnostics: 'test' }]
            };
            const operationOutcome = { toJSON: () => outcomeData };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            const pushed = pushSpy.mock.calls[0][0];
            expect(pushed).toMatch(/\n$/);
            const parsed = JSON.parse(pushed.trim());
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

        test('always sets 500 regardless of current status code', () => {
            mockResponse.statusCode = 404;
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome' })
            };

            writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });

            expect(mockResponse.statusCode).toBe(500);
        });
    });

    describe('getContentType', () => {
        test('returns the configured content type', () => {
            expect(writer.getContentType()).toBe('application/ndjson');
        });

        test('returns custom content type when set differently', () => {
            const customWriter = new FhirResourceNdJsonWriter({
                signal: mockSignal,
                contentType: 'application/x-ndjson',
                highWaterMark: 50,
                configManager: mockConfigManager,
                response: mockResponse
            });

            expect(customWriter.getContentType()).toBe('application/x-ndjson');
        });
    });

    describe('integration scenarios', () => {
        test('full stream lifecycle produces valid NDJSON', (done) => {
            const lines = [];
            jestObj.spyOn(writer, 'push').mockImplementation((data) => {
                if (data !== null) {
                    lines.push(data);
                }
                return true;
            });

            const resources = [
                { id: '1', resourceType: 'Patient' },
                { id: '2', resourceType: 'Observation' },
                { id: '3', resourceType: 'Condition' }
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
                        // Each line should be valid JSON terminated by newline
                        expect(lines).toHaveLength(3);
                        lines.forEach((line, i) => {
                            expect(line).toMatch(/\n$/);
                            const parsed = JSON.parse(line.trim());
                            expect(parsed.id).toBe(String(i + 1));
                        });
                        done();
                    });
                }
            };
            processNext();
        });

        test('empty stream produces no output lines', (done) => {
            const lines = [];
            jestObj.spyOn(writer, 'push').mockImplementation((data) => {
                if (data !== null) {
                    lines.push(data);
                }
                return true;
            });

            writer._flush(() => {
                expect(lines).toHaveLength(0);
                done();
            });
        });

        test('error during stream does not prevent further writes', (done) => {
            const pushSpy = jestObj.spyOn(writer, 'push');

            // First call throws
            FhirResourceSerializer.serialize
                .mockImplementationOnce(() => { throw new Error('fail'); })
                .mockImplementation((obj) => obj);

            writer._transform({ id: '1' }, 'utf8', () => {
                // Second call should succeed
                pushSpy.mockClear();
                writer._transform({ id: '2', resourceType: 'Patient' }, 'utf8', () => {
                    const pushed = pushSpy.mock.calls[0][0];
                    expect(pushed).toMatch(/\n$/);
                    const parsed = JSON.parse(pushed.trim());
                    expect(parsed.id).toBe('2');
                    done();
                });
            });
        });
    });
});
