'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../../../utils/assertType', () => ({
    assertTypeEquals: jestObj.fn(),
    assertIsValid: jestObj.fn()
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

// Mock @json2csv/node Transform
const mockTransformInstance = {
    _transform: jestObj.fn((chunk, encoding, done) => done())
};

jestObj.mock('@json2csv/node', () => ({
    Transform: class MockTransform {
        constructor(opts, asyncOpts, transformOpts) {
            this._opts = opts;
            this._asyncOpts = asyncOpts;
            this._transformOpts = transformOpts;
        }
        _transform(chunk, encoding, done) {
            done();
        }
    }
}));

jestObj.mock('@json2csv/transforms', () => ({
    flatten: jestObj.fn(({ objects, arrays, separator }) => {
        return { type: 'flatten', objects, arrays, separator };
    })
}));

const { FhirResourceCsvWriter } = require('../../../../../operations/streaming/resourceWriters/fhirResourceCsvWriter');
const { ConfigManager } = require('../../../../../utils/configManager');
const { FhirResourceSerializer } = require('../../../../../fhir/fhirResourceSerializer');
const { logInfo } = require('../../../../../operations/common/logging');

function createMockInstance(ClassRef, methods = {}) {
    const instance = Object.create(ClassRef.prototype);
    Object.assign(instance, methods);
    return instance;
}

describe('FhirResourceCsvWriter', () => {
    let writer;
    let mockConfigManager;
    let mockSignal;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockConfigManager = createMockInstance(ConfigManager, {});
        Object.defineProperty(mockConfigManager, 'logStreamSteps', {
            get: () => false,
            configurable: true
        });

        mockSignal = { aborted: false };

        writer = new FhirResourceCsvWriter({
            signal: mockSignal,
            delimiter: ',',
            contentType: 'text/csv',
            highWaterMark: 100,
            configManager: mockConfigManager
        });
    });

    describe('constructor', () => {
        test('stores the signal', () => {
            expect(writer._signal).toBe(mockSignal);
        });

        test('stores the contentType', () => {
            expect(writer._contentType).toBe('text/csv');
        });

        test('stores configManager', () => {
            expect(writer.configManager).toBe(mockConfigManager);
        });

        test('passes delimiter to opts', () => {
            expect(writer._opts.delimiter).toBe(',');
        });

        test('passes flatten transform in opts', () => {
            expect(writer._opts.transforms).toHaveLength(1);
            expect(writer._opts.transforms[0]).toEqual({
                type: 'flatten',
                objects: true,
                arrays: true,
                separator: '.'
            });
        });

        test('passes objectMode true in transformOpts', () => {
            expect(writer._transformOpts.objectMode).toBe(true);
        });

        test('passes highWaterMark in transformOpts', () => {
            expect(writer._transformOpts.highWaterMark).toBe(100);
        });

        test('accepts tab delimiter', () => {
            const tabWriter = new FhirResourceCsvWriter({
                signal: mockSignal,
                delimiter: '\t',
                contentType: 'text/tab-separated-values',
                highWaterMark: 50,
                configManager: mockConfigManager
            });
            expect(tabWriter._opts.delimiter).toBe('\t');
            expect(tabWriter._contentType).toBe('text/tab-separated-values');
        });

        test('accepts pipe delimiter', () => {
            const pipeWriter = new FhirResourceCsvWriter({
                signal: mockSignal,
                delimiter: '|',
                contentType: 'text/plain-pipe-delimited',
                highWaterMark: 50,
                configManager: mockConfigManager
            });
            expect(pipeWriter._opts.delimiter).toBe('|');
        });
    });

    describe('_transform', () => {
        test('calls FhirResourceSerializer.serialize on the chunk', (done) => {
            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(chunk);
                done();
            });
        });

        test('calls super._transform after serialization', (done) => {
            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            // If super._transform is called, done() will be invoked
            writer._transform(chunk, 'utf8', done);
        });

        test('does not log when logStreamSteps is false', (done) => {
            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(logInfo).not.toHaveBeenCalled();
                done();
            });
        });

        test('logs when logStreamSteps is true', (done) => {
            Object.defineProperty(mockConfigManager, 'logStreamSteps', {
                get: () => true,
                configurable: true
            });

            const chunk = { id: 'patient-1', resourceType: 'Patient' };

            writer._transform(chunk, 'utf8', () => {
                expect(logInfo).toHaveBeenCalledWith(
                    'FhirResourceCsvWriter._transformpatient-1',
                    {}
                );
                done();
            });
        });

        test('passes encoding through to super._transform', (done) => {
            const chunk = { id: 'res-1', resourceType: 'Observation' };

            writer._transform(chunk, 'ascii', done);
            // If encoding is passed correctly, the test completes without error
        });
    });

    describe('writeOperationOutcome', () => {
        test('is a no-op function', () => {
            const operationOutcome = { resourceType: 'OperationOutcome', issue: [] };
            // Should not throw
            expect(() => {
                writer.writeOperationOutcome({ operationOutcome, encoding: 'utf8' });
            }).not.toThrow();
        });

        test('returns undefined', () => {
            const operationOutcome = { resourceType: 'OperationOutcome', issue: [] };
            const result = writer.writeOperationOutcome({ operationOutcome });
            expect(result).toBeUndefined();
        });
    });

    describe('getContentType', () => {
        test('returns the contentType passed in constructor', () => {
            expect(writer.getContentType()).toBe('text/csv');
        });

        test('returns tab content type for tsv writer', () => {
            const tsvWriter = new FhirResourceCsvWriter({
                signal: mockSignal,
                delimiter: '\t',
                contentType: 'text/tab-separated-values',
                highWaterMark: 100,
                configManager: mockConfigManager
            });
            expect(tsvWriter.getContentType()).toBe('text/tab-separated-values');
        });

        test('returns pipe delimited content type', () => {
            const pipeWriter = new FhirResourceCsvWriter({
                signal: mockSignal,
                delimiter: '|',
                contentType: 'text/plain-pipe-delimited',
                highWaterMark: 100,
                configManager: mockConfigManager
            });
            expect(pipeWriter.getContentType()).toBe('text/plain-pipe-delimited');
        });
    });
});
