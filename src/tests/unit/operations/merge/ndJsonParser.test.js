const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock express-http-context
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

const httpContext = require('express-http-context');
const { NdjsonParser } = require('../../../../operations/merge/ndJsonParser');
const { ConfigManager } = require('../../../../utils/configManager');
const { ACCESS_LOGS_ENTRY_DATA, STREAM_ACCESS_LOG_BODY_LIMIT } = require('../../../../constants');

/**
 * Creates a ConfigManager mock that passes assertTypeEquals
 * @param {object} overrides - property overrides
 * @returns {ConfigManager}
 */
function createMockConfigManager(overrides = {}) {
    const instance = Object.create(ConfigManager.prototype);
    Object.defineProperty(instance, 'enableAccessLogs', {
        get: () => overrides.enableAccessLogs !== undefined ? overrides.enableAccessLogs : false,
        configurable: true
    });
    return instance;
}

describe('NdjsonParser', () => {
    let configManager;

    beforeEach(() => {
        jest.clearAllMocks();
        configManager = createMockConfigManager({ enableAccessLogs: false });
    });

    describe('constructor', () => {
        test('should create instance with valid configManager', () => {
            const parser = new NdjsonParser({ configManager });
            expect(parser._buffer).toBe('');
            expect(parser.access_log_request_body).toEqual([]);
        });

        test('should throw if configManager is null', () => {
            expect(() => new NdjsonParser({ configManager: null })).toThrow();
        });

        test('should throw if configManager is wrong type', () => {
            expect(() => new NdjsonParser({ configManager: {} })).toThrow();
        });
    });

    describe('_transform', () => {
        test('should parse single complete NDJSON line', (done) => {
            const parser = new NdjsonParser({ configManager });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(data).toHaveLength(1);
                expect(data[0]).toEqual({ resourceType: 'Patient', id: '1' });
                done();
            });

            parser.write('{"resourceType":"Patient","id":"1"}\n');
            parser.end();
        });

        test('should parse multiple complete NDJSON lines', (done) => {
            const parser = new NdjsonParser({ configManager });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(data).toHaveLength(3);
                expect(data[0]).toEqual({ id: '1' });
                expect(data[1]).toEqual({ id: '2' });
                expect(data[2]).toEqual({ id: '3' });
                done();
            });

            parser.write('{"id":"1"}\n{"id":"2"}\n{"id":"3"}\n');
            parser.end();
        });

        test('should handle empty input (0 lines)', (done) => {
            const parser = new NdjsonParser({ configManager });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(data).toHaveLength(0);
                done();
            });

            parser.end();
        });

        test('should buffer incomplete lines across chunks', (done) => {
            const parser = new NdjsonParser({ configManager });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(data).toHaveLength(1);
                expect(data[0]).toEqual({ id: '1', name: 'test' });
                done();
            });

            // Split a JSON line across two chunks
            parser.write('{"id":"1",');
            parser.write('"name":"test"}\n');
            parser.end();
        });

        test('should skip blank lines', (done) => {
            const parser = new NdjsonParser({ configManager });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(data).toHaveLength(2);
                done();
            });

            parser.write('{"id":"1"}\n\n\n{"id":"2"}\n');
            parser.end();
        });

        test('should emit error on invalid JSON', (done) => {
            const parser = new NdjsonParser({ configManager });
            parser.on('error', (err) => {
                expect(err.message).toContain('Invalid NDJSON');
                done();
            });

            parser.write('not valid json\n');
        });

        test('should handle last line without trailing newline via _flush', (done) => {
            const parser = new NdjsonParser({ configManager });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(data).toHaveLength(2);
                expect(data[1]).toEqual({ id: '2' });
                done();
            });

            parser.write('{"id":"1"}\n{"id":"2"}');
            parser.end();
        });

        test('should emit error on invalid JSON in _flush', (done) => {
            const parser = new NdjsonParser({ configManager });
            parser.on('error', (err) => {
                expect(err.message).toContain('Invalid NDJSON on flush');
                done();
            });

            parser.write('{"id":"1"}\ninvalid');
            parser.end();
        });
    });

    describe('access log behavior', () => {
        test('should log request body when enableAccessLogs is true', (done) => {
            const configWithLogs = createMockConfigManager({ enableAccessLogs: true });
            const parser = new NdjsonParser({ configManager: configWithLogs });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(parser.access_log_request_body.length).toBeGreaterThan(0);
                done();
            });

            parser.write('{"id":"1"}\n');
            parser.end();
        });

        test('should NOT log request body when enableAccessLogs is false', (done) => {
            const parser = new NdjsonParser({ configManager });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(parser.access_log_request_body).toHaveLength(0);
                done();
            });

            parser.write('{"id":"1"}\n');
            parser.end();
        });

        test('should respect STREAM_ACCESS_LOG_BODY_LIMIT', (done) => {
            const configWithLogs = createMockConfigManager({ enableAccessLogs: true });
            const parser = new NdjsonParser({ configManager: configWithLogs });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                // Should cap at STREAM_ACCESS_LOG_BODY_LIMIT
                expect(parser.access_log_request_body.length).toBeLessThanOrEqual(STREAM_ACCESS_LOG_BODY_LIMIT);
                done();
            });

            // Write more lines than the limit
            const lines = [];
            for (let i = 0; i < STREAM_ACCESS_LOG_BODY_LIMIT + 10; i++) {
                lines.push(`{"id":"${i}"}`);
            }
            parser.write(lines.join('\n') + '\n');
            parser.end();
        });

        test('should call httpContext.set on flush with access logs enabled', (done) => {
            const configWithLogs = createMockConfigManager({ enableAccessLogs: true });
            const parser = new NdjsonParser({ configManager: configWithLogs });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                expect(httpContext.set).toHaveBeenCalledWith(
                    ACCESS_LOGS_ENTRY_DATA,
                    expect.objectContaining({
                        streamRequestBody: expect.stringContaining('STREAMED')
                    })
                );
                done();
            });

            // Write without trailing newline so _flush processes remaining buffer
            parser.write('{"id":"1"}');
            parser.end();
        });

        test('should NOT call httpContext.set when buffer is empty on flush', (done) => {
            const configWithLogs = createMockConfigManager({ enableAccessLogs: true });
            const parser = new NdjsonParser({ configManager: configWithLogs });
            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                // When trailing newline is present, buffer should be empty on flush
                expect(httpContext.set).not.toHaveBeenCalled();
                done();
            });

            parser.write('{"id":"1"}\n');
            parser.end();
        });

        test('BUG: _flush always logs to httpContext even when STREAM_ACCESS_LOG_BODY_LIMIT exceeded', (done) => {
            // The _flush method does not check STREAM_ACCESS_LOG_BODY_LIMIT before pushing to access_log_request_body.
            // This means the last buffered line always gets logged regardless of the limit.
            const configWithLogs = createMockConfigManager({ enableAccessLogs: true });
            const parser = new NdjsonParser({ configManager: configWithLogs });

            // Pre-fill the access log to simulate reaching the limit
            for (let i = 0; i < STREAM_ACCESS_LOG_BODY_LIMIT; i++) {
                parser.access_log_request_body.push(`{"id":"${i}"}`);
            }

            const data = [];
            parser.on('data', (chunk) => data.push(chunk));
            parser.on('end', () => {
                // BUG: _flush does NOT check STREAM_ACCESS_LOG_BODY_LIMIT,
                // so it pushes beyond the limit
                expect(parser.access_log_request_body.length).toBe(STREAM_ACCESS_LOG_BODY_LIMIT + 1);
                done();
            });

            // Write without trailing newline so _flush processes remaining buffer
            parser.write('{"id":"overflow"}');
            parser.end();
        });
    });

    describe('data isolation between requests', () => {
        test('buffer state does not leak between parser instances', () => {
            const parser1 = new NdjsonParser({ configManager });
            const parser2 = new NdjsonParser({ configManager });

            parser1._buffer = 'leftover';
            expect(parser2._buffer).toBe('');
        });

        test('access_log_request_body does not leak between parser instances', () => {
            const parser1 = new NdjsonParser({ configManager });
            parser1.access_log_request_body.push('data');

            const parser2 = new NdjsonParser({ configManager });
            expect(parser2.access_log_request_body).toHaveLength(0);
        });
    });
});
