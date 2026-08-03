const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../winstonInit', () => ({
    getLogger: jestObj.fn(() => ({
        info: jestObj.fn(),
        warn: jestObj.fn(),
        verbose: jestObj.fn(),
        error: jestObj.fn()
    }))
}));

jestObj.mock('../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn(),
    assertTypeEquals: jestObj.fn()
}));

jestObj.mock('../../../../utils/contentTypes', () => ({
    hasNdJsonContentType: jestObj.fn()
}));

jestObj.mock('../../../../utils/configManager', () => ({
    ConfigManager: class ConfigManager {}
}));

jestObj.mock('../../../../utils/rethrownError', () => ({
    RethrownError: class RethrownError extends Error {
        constructor({ message, error, args }) {
            super(message);
            this.innerError = error;
            this.args = args;
        }
    }
}));

const { HttpResponseWriter } = require('../../../../operations/streaming/responseWriter');
const { hasNdJsonContentType } = require('../../../../utils/contentTypes');

describe('HttpResponseWriter', () => {
    let writer;
    let mockResponse;
    let mockSignal;
    let mockConfigManager;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            removeHeader: jestObj.fn(),
            setHeader: jestObj.fn(),
            setTimeout: jestObj.fn(),
            write: jestObj.fn(),
            writable: true,
            headersSent: false,
            flushHeaders: jestObj.fn(),
            end: jestObj.fn()
        };

        mockSignal = {
            aborted: false
        };

        mockConfigManager = {
            logStreamSteps: false
        };

        writer = new HttpResponseWriter({
            requestId: 'test-request-123',
            response: mockResponse,
            contentType: 'application/fhir+json',
            signal: mockSignal,
            highWaterMark: 16,
            configManager: mockConfigManager
        });
    });

    describe('constructor', () => {
        test('stores response, contentType, signal, requestId and configManager', () => {
            expect(writer.response).toBe(mockResponse);
            expect(writer.contentType).toBe('application/fhir+json');
            expect(writer._signal).toBe(mockSignal);
            expect(writer.requestId).toBe('test-request-123');
            expect(writer.configManager).toBe(mockConfigManager);
        });

        test('is an instance of Writable stream', () => {
            const { Writable } = require('stream');
            expect(writer).toBeInstanceOf(Writable);
        });
    });

    describe('_construct', () => {
        test('sets correct headers on response', (done) => {
            writer._construct((err) => {
                expect(err).toBeUndefined();
                expect(mockResponse.removeHeader).toHaveBeenCalledWith('Content-Length');
                expect(mockResponse.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
                expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'test-request-123');
                expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/fhir+json');
                done();
            });
        });

        test('sets response timeout to 1 hour', (done) => {
            writer._construct((err) => {
                expect(mockResponse.setTimeout).toHaveBeenCalledWith(
                    60 * 60 * 1000,
                    expect.any(Function)
                );
                done();
            });
        });
    });

    describe('_write', () => {
        test('writes chunk to response when signal is not aborted', (done) => {
            writer._write('{"id":"123"}', 'utf8', () => {
                expect(mockResponse.write).toHaveBeenCalledWith('{"id":"123"}', 'utf8', expect.any(Function));
                done();
            });
        });

        test('does nothing when signal is aborted', (done) => {
            mockSignal.aborted = true;

            writer._write('{"id":"123"}', 'utf8', (err) => {
                expect(err).toBeUndefined();
                expect(mockResponse.write).not.toHaveBeenCalled();
                done();
            });
        });

        test('calls callback without writing when chunk is null', (done) => {
            writer._write(null, 'utf8', (err) => {
                expect(err).toBeUndefined();
                expect(mockResponse.write).not.toHaveBeenCalled();
                done();
            });
        });

        test('calls callback without writing when chunk is undefined', (done) => {
            writer._write(undefined, 'utf8', (err) => {
                expect(err).toBeUndefined();
                expect(mockResponse.write).not.toHaveBeenCalled();
                done();
            });
        });

        test('flushes headers before first write if not already sent', (done) => {
            mockResponse.headersSent = false;

            writer._write('data', 'utf8', (err) => {
                expect(mockResponse.flushHeaders).toHaveBeenCalled();
                done();
            });
        });

        test('does not flush headers if already sent', (done) => {
            mockResponse.headersSent = true;

            writer._write('data', 'utf8', (err) => {
                expect(mockResponse.flushHeaders).not.toHaveBeenCalled();
                done();
            });
        });

        test('does not write if response is not writable', (done) => {
            mockResponse.writable = false;

            writer._write('data', 'utf8', (err) => {
                expect(mockResponse.write).not.toHaveBeenCalled();
                done();
            });
        });

        test('logs verbose when logStreamSteps is enabled and content is ndjson', (done) => {
            mockConfigManager.logStreamSteps = true;
            hasNdJsonContentType.mockReturnValue(true);

            writer._write('{"id":"resource-1"}', 'utf8', (err) => {
                expect(hasNdJsonContentType).toHaveBeenCalledWith(['application/fhir+json']);
                done();
            });
        });

        test('logs verbose with chunk content when logStreamSteps enabled and not ndjson', (done) => {
            mockConfigManager.logStreamSteps = true;
            hasNdJsonContentType.mockReturnValue(false);

            writer._write('some-data', 'utf8', (err) => {
                expect(hasNdJsonContentType).toHaveBeenCalled();
                done();
            });
        });

        test('passes RethrownError to callback on exception', (done) => {
            mockResponse.write = jestObj.fn(() => {
                throw new Error('Write failed');
            });

            writer._write('{"id":"1"}', 'utf8', (err) => {
                expect(err).toBeDefined();
                expect(err.message).toContain('HttpResponseWriter _transform: error: Write failed');
                done();
            });
        });
    });

    describe('_final', () => {
        test('ends the response when writable', (done) => {
            writer._final((err) => {
                expect(err).toBeUndefined();
                expect(mockResponse.end).toHaveBeenCalled();
                done();
            });
        });

        test('does not end response when not writable', (done) => {
            mockResponse.writable = false;

            writer._final((err) => {
                expect(err).toBeUndefined();
                expect(mockResponse.end).not.toHaveBeenCalled();
                done();
            });
        });
    });
});
