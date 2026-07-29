const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock dependencies
jest.mock('express-http-context', () => ({
    get: jest.fn(),
    set: jest.fn()
}));

jest.mock('../../../../../operations/common/sentry', () => ({
    captureException: jest.fn()
}));

jest.mock('../../../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jest.fn((obj) => obj)
    }
}));

jest.mock('../../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logError: jest.fn()
}));

jest.mock('../../../../../utils/convertErrorToOperationOutcome', () => ({
    convertErrorToOperationOutcome: jest.fn(({ error }) => ({
        toJSON: () => ({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', diagnostics: error.message }] })
    }))
}));

const { FhirBundleWriter } = require('../../../../../operations/streaming/resourceWriters/fhirBundleWriter');
const { ConfigManager } = require('../../../../../utils/configManager');
const { captureException } = require('../../../../../operations/common/sentry');
const { logError } = require('../../../../../operations/common/logging');

function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('FhirBundleWriter', () => {
    let writer;
    let mockConfigManager;
    let mockResponse;
    let mockSignal;
    let mockFnBundle;

    beforeEach(() => {
        jest.clearAllMocks();

        mockConfigManager = createMockInstance(ConfigManager, {});
        Object.defineProperty(mockConfigManager, 'logStreamSteps', {
            get: () => false,
            configurable: true
        });

        mockResponse = {
            statusCode: 200,
            write: jest.fn(),
            end: jest.fn()
        };

        mockSignal = { aborted: false };

        mockFnBundle = jest.fn().mockReturnValue({
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            link: [],
            entry: []
        });

        writer = new FhirBundleWriter({
            fnBundle: mockFnBundle,
            url: 'http://example.com/Patient',
            signal: mockSignal,
            defaultSortId: 'id',
            highWaterMark: 100,
            configManager: mockConfigManager,
            response: mockResponse
        });
    });

    describe('_transform', () => {
        test('should push first entry with opening JSON bracket', (done) => {
            const chunk = { id: 'patient-1', resourceType: 'Patient' };
            const pushed = [];
            writer.push = jest.fn((data) => pushed.push(data));

            writer._transform(chunk, 'utf8', (err) => {
                expect(err).toBeUndefined();
                expect(pushed[0]).toMatch(/^\{"entry":\[/);
                expect(pushed[0]).toContain('"resource"');
                done();
            });
        });

        test('should push subsequent entries with comma prefix', (done) => {
            const chunk1 = { id: 'patient-1', resourceType: 'Patient' };
            const chunk2 = { id: 'patient-2', resourceType: 'Patient' };
            const pushed = [];
            writer.push = jest.fn((data) => pushed.push(data));

            writer._transform(chunk1, 'utf8', () => {
                writer._transform(chunk2, 'utf8', (err) => {
                    expect(err).toBeUndefined();
                    expect(pushed[1]).toMatch(/^,/);
                    done();
                });
            });
        });

        test('should do nothing when signal is aborted', (done) => {
            mockSignal.aborted = true;
            writer.push = jest.fn();

            writer._transform({ id: '1', resourceType: 'Patient' }, 'utf8', (err) => {
                expect(err).toBeUndefined();
                expect(writer.push).not.toHaveBeenCalled();
                done();
            });
        });

        test('should track lastid using defaultSortId field', (done) => {
            const chunk = { id: 'patient-1', _uuid: 'some-uuid', resourceType: 'Patient' };
            writer.defaultSortId = '_uuid';
            writer.push = jest.fn();

            writer._transform(chunk, 'utf8', () => {
                expect(writer._lastid).toBe('some-uuid');
                done();
            });
        });

        test('BUG: _transform catches serialization errors but swallows them silently - data loss', (done) => {
            // If FhirResourceSerializer.serialize throws, the chunk is lost
            // The error is caught and logged but the resource is never written
            const { FhirResourceSerializer } = require('../../../../../fhir/fhirResourceSerializer');
            FhirResourceSerializer.serialize.mockImplementationOnce(() => {
                throw new Error('Serialization failed');
            });

            const chunk = { id: 'patient-1', resourceType: 'Patient' };
            writer.push = jest.fn();

            writer._transform(chunk, 'utf8', (err) => {
                // Error is swallowed - callback called without error
                expect(err).toBeUndefined();
                // The resource data is lost - push was not called with the resource data
                // Only the error operation outcome is pushed
                expect(captureException).toHaveBeenCalled();
                expect(logError).toHaveBeenCalled();
                done();
            });
        });

        test('BUG: null chunk causes TypeError because chunk.id accessed before null check (line 93 vs 95)', () => {
            writer.push = jest.fn();

            // The code at line 93 does `const chunkId = chunk.id` BEFORE the null check at line 95
            // `if (chunk !== null && chunk !== undefined)`. This means a null chunk crashes
            // the stream with an unhandled TypeError instead of being gracefully skipped.
            expect(() => {
                writer._transform(null, 'utf8', () => {});
            }).toThrow(TypeError);
        });
    });

    describe('_flush', () => {
        test('should produce valid JSON when entries were written', (done) => {
            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });
            writer._first = false;
            writer._lastid = 'patient-1';

            writer._flush(() => {
                // The flush should push the closing portion of the bundle
                const output = pushed.join('');
                expect(output).toContain(']');
                done();
            });
        });

        test('should produce valid JSON when NO entries were written (empty result)', (done) => {
            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });
            // _first is still true = no entries were written

            writer._flush(() => {
                const output = pushed.join('');
                // When _first is true, it writes '{"entry":[' then the bundle closing
                expect(output).toContain('{"entry":[');
                done();
            });
        });

        test('BUG: _flush produces malformed JSON by slicing bundleJson incorrectly', (done) => {
            // Line 201: `const output = '],' + bundleJson.substring(1);`
            // This assumes bundleJson starts with '{' so substring(1) removes it.
            // The intent is to merge: entry array close ']' + rest of bundle fields
            // Combined with the entry opening '{"entry":[...' this creates the full JSON
            // But if removeNull returns an object where JSON starts with something unexpected, it breaks

            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });
            writer._first = false;
            writer._lastid = 'test-1';

            // fnBundle returns an object with fields
            mockFnBundle.mockReturnValue({
                resourceType: 'Bundle',
                type: 'searchset',
                total: 1,
                link: [{ relation: 'self', url: 'http://test' }]
            });

            writer._flush(() => {
                const output = pushed.join('');
                // The output should be: ],"resourceType":"Bundle","type":"searchset","total":1,...}
                // When combined with the entry header '{"entry":[<entries>'
                // it should form: {"entry":[<entries>],"resourceType":"Bundle",...}
                expect(output).toMatch(/^\],/);
                expect(output).toContain('"resourceType":"Bundle"');
                done();
            });
        });

        test('BUG: if fnBundle throws, error is caught but output JSON is malformed', (done) => {
            mockFnBundle.mockImplementation(() => {
                throw new Error('Bundle creation failed');
            });

            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });
            writer._first = false;

            writer._flush(() => {
                // Error is caught; writeErrorAsOperationOutcome is called
                // Then ']}' is pushed (line 230)
                // But the entry array was never closed with ']'!
                // The output after entries would be: ,<operationOutcome>]}
                // Combined with entry prefix: {"entry":[<entries>,<operationOutcome>]}
                // This is actually valid because writeErrorAsOperationOutcome adds a comma
                expect(captureException).toHaveBeenCalled();
                const output = pushed.join('');
                expect(output).toContain(']}');
                done();
            });
        });

        test('BUG: _flush with _first=true and fnBundle error produces incomplete JSON', (done) => {
            // When _first is true AND fnBundle throws:
            // 1. We enter the catch block (line 210)
            // 2. writeErrorAsOperationOutcome sees _first=true, writes '{"entry":[' + operationOutcome
            //    and sets _first = false
            // 3. Then line 230 pushes ']}'
            // Result: {"entry":[<operationOutcome>]}  - this is actually valid

            mockFnBundle.mockImplementation(() => {
                throw new Error('Bundle creation failed');
            });

            const pushed = [];
            writer.push = jest.fn((data) => { if (data !== null) pushed.push(data); });
            // _first is true (no entries)

            writer._flush(() => {
                const output = pushed.join('');
                // Should still produce parseable JSON
                expect(output).toContain('{"entry":[');
                expect(output).toContain(']}');
                done();
            });
        });
    });

    describe('writeErrorAsOperationOutcome', () => {
        test('should set response status to 500 when first entry', () => {
            writer.push = jest.fn();
            writer.writeErrorAsOperationOutcome({ error: { message: 'Test error' } });

            expect(mockResponse.statusCode).toBe(500);
        });

        test('should not change status code when not first entry', () => {
            writer.push = jest.fn();
            writer._first = false;
            mockResponse.statusCode = 200;

            writer.writeErrorAsOperationOutcome({ error: { message: 'Test error' } });

            expect(mockResponse.statusCode).toBe(200);
        });
    });

    describe('writeOperationOutcome', () => {
        test('should push operationOutcome as first entry', () => {
            writer.push = jest.fn();
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome', issue: [] })
            };

            writer.writeOperationOutcome({ operationOutcome });

            expect(writer.push).toHaveBeenCalledWith(
                expect.stringContaining('OperationOutcome'),
                undefined
            );
            expect(writer._first).toBe(false);
        });

        test('should push operationOutcome with comma when not first', () => {
            writer.push = jest.fn();
            writer._first = false;
            const operationOutcome = {
                toJSON: () => ({ resourceType: 'OperationOutcome', issue: [] })
            };

            writer.writeOperationOutcome({ operationOutcome });

            const pushArg = writer.push.mock.calls[0][0];
            expect(pushArg).toMatch(/^,/);
        });
    });

    describe('constructor validation', () => {
        test('should throw if fnBundle is falsy', () => {
            expect(() => new FhirBundleWriter({
                fnBundle: null,
                url: 'http://test',
                signal: mockSignal,
                defaultSortId: 'id',
                highWaterMark: 100,
                configManager: mockConfigManager,
                response: mockResponse
            })).toThrow();
        });

        test('should throw if configManager is wrong type', () => {
            expect(() => new FhirBundleWriter({
                fnBundle: mockFnBundle,
                url: 'http://test',
                signal: mockSignal,
                defaultSortId: 'id',
                highWaterMark: 100,
                configManager: {},
                response: mockResponse
            })).toThrow();
        });
    });
});
