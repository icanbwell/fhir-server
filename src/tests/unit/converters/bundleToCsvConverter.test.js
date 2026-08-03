'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock the external dependency
const mockConvertBundleToDictionaries = jestObj.fn();
const mockConvertResourcesToDictionaries = jestObj.fn();
const mockConvertToCSVZipped = jestObj.fn();

jestObj.mock('@icanbwell/fhir-to-csv/lib/fhir_bundle_converter', () => ({
    FHIRBundleConverter: jestObj.fn().mockImplementation(() => ({
        convertBundleToDictionaries: mockConvertBundleToDictionaries,
        convertResourcesToDictionaries: mockConvertResourcesToDictionaries,
        convertToCSVZipped: mockConvertToCSVZipped
    }))
}));

const { BundleToCsvConverter } = require('../../../converters/bundleToCsvConverter');
const { BaseBundleConverter } = require('../../../converters/baseBundleConverter');
const { FHIRBundleConverter } = require('@icanbwell/fhir-to-csv/lib/fhir_bundle_converter');

describe('BundleToCsvConverter', () => {
    let converter;

    beforeEach(() => {
        jestObj.clearAllMocks();
        converter = new BundleToCsvConverter();
    });

    describe('class hierarchy', () => {
        test('extends BaseBundleConverter', () => {
            expect(converter).toBeInstanceOf(BaseBundleConverter);
        });

        test('is an instance of BundleToCsvConverter', () => {
            expect(converter).toBeInstanceOf(BundleToCsvConverter);
        });
    });

    describe('convert', () => {
        test('throws "Bundle is not set" when bundle is null', () => {
            expect(() => converter.convert({ bundle: null })).toThrow('Bundle is not set');
        });

        test('throws "Bundle is not set" when bundle is undefined', () => {
            expect(() => converter.convert({ bundle: undefined })).toThrow('Bundle is not set');
        });

        test('throws "Bundle is not set" when bundle is falsy (0)', () => {
            expect(() => converter.convert({ bundle: 0 })).toThrow('Bundle is not set');
        });

        test('throws "Bundle is not set" when bundle is empty string', () => {
            expect(() => converter.convert({ bundle: '' })).toThrow('Bundle is not set');
        });

        test('creates a new FHIRBundleConverter instance', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            mockConvertBundleToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from('csv-zip'));

            converter.convert({ bundle });

            expect(FHIRBundleConverter).toHaveBeenCalledTimes(1);
        });

        test('calls convertBundleToDictionaries with the bundle', () => {
            const bundle = { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: '1' } }] };
            mockConvertBundleToDictionaries.mockReturnValue([{ Patient: [{ id: '1' }] }]);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from('zipped'));

            converter.convert({ bundle });

            expect(mockConvertBundleToDictionaries).toHaveBeenCalledWith(bundle);
        });

        test('passes extractedData to convertToCSVZipped', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            const extractedData = [{ Patient: [{ id: '1', name: 'John' }] }];
            mockConvertBundleToDictionaries.mockReturnValue(extractedData);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from('zip-content'));

            converter.convert({ bundle });

            expect(mockConvertToCSVZipped).toHaveBeenCalledWith(extractedData);
        });

        test('returns the zip buffer from convertToCSVZipped', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            const expectedBuffer = Buffer.from('expected-zip-content');
            mockConvertBundleToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockReturnValue(expectedBuffer);

            const result = converter.convert({ bundle });

            expect(result).toBe(expectedBuffer);
        });

        test('propagates errors from convertBundleToDictionaries', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            mockConvertBundleToDictionaries.mockImplementation(() => {
                throw new Error('Invalid bundle structure');
            });

            expect(() => converter.convert({ bundle })).toThrow('Invalid bundle structure');
        });

        test('propagates errors from convertToCSVZipped', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            mockConvertBundleToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockImplementation(() => {
                throw new Error('Zip creation failed');
            });

            expect(() => converter.convert({ bundle })).toThrow('Zip creation failed');
        });

        test('works with bundle containing multiple entries', () => {
            const bundle = {
                resourceType: 'Bundle',
                type: 'searchset',
                entry: [
                    { resource: { resourceType: 'Patient', id: '1' } },
                    { resource: { resourceType: 'Observation', id: '2' } }
                ]
            };
            const extractedData = { Patient: [{ id: '1' }], Observation: [{ id: '2' }] };
            mockConvertBundleToDictionaries.mockReturnValue(extractedData);
            const zipBuffer = Buffer.from('multi-resource-zip');
            mockConvertToCSVZipped.mockReturnValue(zipBuffer);

            const result = converter.convert({ bundle });

            expect(result).toBe(zipBuffer);
            expect(mockConvertBundleToDictionaries).toHaveBeenCalledWith(bundle);
        });
    });

    describe('convertResources', () => {
        test('creates a new FHIRBundleConverter instance', () => {
            const resources = [{ resourceType: 'Patient', id: '1' }];
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from('csv-zip'));

            converter.convertResources({ resources });

            expect(FHIRBundleConverter).toHaveBeenCalledTimes(1);
        });

        test('calls convertResourcesToDictionaries with resources array', () => {
            const resources = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];
            mockConvertResourcesToDictionaries.mockReturnValue([{ Patient: [{ id: '1' }, { id: '2' }] }]);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from('zipped'));

            converter.convertResources({ resources });

            expect(mockConvertResourcesToDictionaries).toHaveBeenCalledWith(resources);
        });

        test('passes extractedData to convertToCSVZipped', () => {
            const resources = [{ resourceType: 'Observation', id: 'obs-1' }];
            const extractedData = { Observation: [{ id: 'obs-1' }] };
            mockConvertResourcesToDictionaries.mockReturnValue(extractedData);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from('csv'));

            converter.convertResources({ resources });

            expect(mockConvertToCSVZipped).toHaveBeenCalledWith(extractedData);
        });

        test('returns the zip buffer from convertToCSVZipped', () => {
            const resources = [];
            const expectedBuffer = Buffer.from('resources-zip');
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockReturnValue(expectedBuffer);

            const result = converter.convertResources({ resources });

            expect(result).toBe(expectedBuffer);
        });

        test('does NOT throw when resources is empty array', () => {
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from('empty'));

            expect(() => converter.convertResources({ resources: [] })).not.toThrow();
        });

        test('does NOT throw when resources is null (no guard in method)', () => {
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockReturnValue(Buffer.from(''));

            // Unlike convert(), convertResources does not check for null/falsy
            expect(() => converter.convertResources({ resources: null })).not.toThrow();
            expect(mockConvertResourcesToDictionaries).toHaveBeenCalledWith(null);
        });

        test('propagates errors from convertResourcesToDictionaries', () => {
            const resources = [{ resourceType: 'Patient', id: '1' }];
            mockConvertResourcesToDictionaries.mockImplementation(() => {
                throw new Error('Resource parsing failed');
            });

            expect(() => converter.convertResources({ resources })).toThrow('Resource parsing failed');
        });

        test('propagates errors from convertToCSVZipped', () => {
            const resources = [{ resourceType: 'Patient', id: '1' }];
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToCSVZipped.mockImplementation(() => {
                throw new Error('CSV zip failure');
            });

            expect(() => converter.convertResources({ resources })).toThrow('CSV zip failure');
        });
    });
});
