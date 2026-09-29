'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock the external dependency
const mockConvertBundleToDictionaries = jestObj.fn();
const mockConvertResourcesToDictionaries = jestObj.fn();
const mockConvertToExcel = jestObj.fn();

jestObj.mock('@icanbwell/fhir-to-csv/lib/fhir_bundle_converter', () => ({
    FHIRBundleConverter: jestObj.fn().mockImplementation(() => ({
        convertBundleToDictionaries: mockConvertBundleToDictionaries,
        convertResourcesToDictionaries: mockConvertResourcesToDictionaries,
        convertToExcel: mockConvertToExcel
    }))
}));

const { BundleToExcelConverter } = require('../../../converters/bundleToExcelConverter');
const { BaseBundleConverter } = require('../../../converters/baseBundleConverter');
const { FHIRBundleConverter } = require('@icanbwell/fhir-to-csv/lib/fhir_bundle_converter');

describe('BundleToExcelConverter', () => {
    let converter;

    beforeEach(() => {
        jestObj.clearAllMocks();
        converter = new BundleToExcelConverter();
    });

    describe('class hierarchy', () => {
        test('extends BaseBundleConverter', () => {
            expect(converter).toBeInstanceOf(BaseBundleConverter);
        });

        test('is an instance of BundleToExcelConverter', () => {
            expect(converter).toBeInstanceOf(BundleToExcelConverter);
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
            mockConvertToExcel.mockReturnValue(Buffer.from('excel'));

            converter.convert({ bundle });

            expect(FHIRBundleConverter).toHaveBeenCalledTimes(1);
        });

        test('calls convertBundleToDictionaries with the bundle', () => {
            const bundle = { resourceType: 'Bundle', entry: [{ resource: { resourceType: 'Patient', id: '1' } }] };
            mockConvertBundleToDictionaries.mockReturnValue([{ Patient: [{ id: '1' }] }]);
            mockConvertToExcel.mockReturnValue(Buffer.from('excel-content'));

            converter.convert({ bundle });

            expect(mockConvertBundleToDictionaries).toHaveBeenCalledWith(bundle);
        });

        test('passes extractedData to convertToExcel', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            const extractedData = [{ Patient: [{ id: '1', name: 'Jane' }] }];
            mockConvertBundleToDictionaries.mockReturnValue(extractedData);
            mockConvertToExcel.mockReturnValue(Buffer.from('excel-bytes'));

            converter.convert({ bundle });

            expect(mockConvertToExcel).toHaveBeenCalledWith(extractedData);
        });

        test('returns the excel buffer from convertToExcel', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            const expectedBuffer = Buffer.from('expected-excel-content');
            mockConvertBundleToDictionaries.mockReturnValue([]);
            mockConvertToExcel.mockReturnValue(expectedBuffer);

            const result = converter.convert({ bundle });

            expect(result).toBe(expectedBuffer);
        });

        test('propagates errors from convertBundleToDictionaries', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            mockConvertBundleToDictionaries.mockImplementation(() => {
                throw new Error('Invalid bundle format');
            });

            expect(() => converter.convert({ bundle })).toThrow('Invalid bundle format');
        });

        test('propagates errors from convertToExcel', () => {
            const bundle = { resourceType: 'Bundle', entry: [] };
            mockConvertBundleToDictionaries.mockReturnValue([]);
            mockConvertToExcel.mockImplementation(() => {
                throw new Error('Excel generation failed');
            });

            expect(() => converter.convert({ bundle })).toThrow('Excel generation failed');
        });

        test('works with bundle containing multiple resource types', () => {
            const bundle = {
                resourceType: 'Bundle',
                type: 'searchset',
                entry: [
                    { resource: { resourceType: 'Patient', id: '1' } },
                    { resource: { resourceType: 'Condition', id: '2' } },
                    { resource: { resourceType: 'MedicationRequest', id: '3' } }
                ]
            };
            const extractedData = {
                Patient: [{ id: '1' }],
                Condition: [{ id: '2' }],
                MedicationRequest: [{ id: '3' }]
            };
            mockConvertBundleToDictionaries.mockReturnValue(extractedData);
            const excelBuffer = Buffer.from('multi-sheet-excel');
            mockConvertToExcel.mockReturnValue(excelBuffer);

            const result = converter.convert({ bundle });

            expect(result).toBe(excelBuffer);
            expect(mockConvertBundleToDictionaries).toHaveBeenCalledWith(bundle);
        });
    });

    describe('convertResources', () => {
        test('creates a new FHIRBundleConverter instance', () => {
            const resources = [{ resourceType: 'Patient', id: '1' }];
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToExcel.mockReturnValue(Buffer.from('excel'));

            converter.convertResources({ resources });

            expect(FHIRBundleConverter).toHaveBeenCalledTimes(1);
        });

        test('calls convertResourcesToDictionaries with resources array', () => {
            const resources = [
                { resourceType: 'Patient', id: '1' },
                { resourceType: 'Patient', id: '2' }
            ];
            mockConvertResourcesToDictionaries.mockReturnValue([{ Patient: [{ id: '1' }, { id: '2' }] }]);
            mockConvertToExcel.mockReturnValue(Buffer.from('excel'));

            converter.convertResources({ resources });

            expect(mockConvertResourcesToDictionaries).toHaveBeenCalledWith(resources);
        });

        test('passes extractedData to convertToExcel', () => {
            const resources = [{ resourceType: 'Observation', id: 'obs-1' }];
            const extractedData = { Observation: [{ id: 'obs-1' }] };
            mockConvertResourcesToDictionaries.mockReturnValue(extractedData);
            mockConvertToExcel.mockReturnValue(Buffer.from('excel-data'));

            converter.convertResources({ resources });

            expect(mockConvertToExcel).toHaveBeenCalledWith(extractedData);
        });

        test('returns the excel buffer from convertToExcel', () => {
            const resources = [];
            const expectedBuffer = Buffer.from('resources-excel');
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToExcel.mockReturnValue(expectedBuffer);

            const result = converter.convertResources({ resources });

            expect(result).toBe(expectedBuffer);
        });

        test('does NOT throw when resources is empty array', () => {
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToExcel.mockReturnValue(Buffer.from('empty'));

            expect(() => converter.convertResources({ resources: [] })).not.toThrow();
        });

        test('does NOT throw when resources is null (no guard in method)', () => {
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToExcel.mockReturnValue(Buffer.from(''));

            // Unlike convert(), convertResources does not check for null/falsy
            expect(() => converter.convertResources({ resources: null })).not.toThrow();
            expect(mockConvertResourcesToDictionaries).toHaveBeenCalledWith(null);
        });

        test('propagates errors from convertResourcesToDictionaries', () => {
            const resources = [{ resourceType: 'Patient', id: '1' }];
            mockConvertResourcesToDictionaries.mockImplementation(() => {
                throw new Error('Resource conversion error');
            });

            expect(() => converter.convertResources({ resources })).toThrow('Resource conversion error');
        });

        test('propagates errors from convertToExcel', () => {
            const resources = [{ resourceType: 'Patient', id: '1' }];
            mockConvertResourcesToDictionaries.mockReturnValue([]);
            mockConvertToExcel.mockImplementation(() => {
                throw new Error('Excel write failure');
            });

            expect(() => converter.convertResources({ resources })).toThrow('Excel write failure');
        });
    });
});
