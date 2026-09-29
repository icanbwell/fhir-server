'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock dependencies
jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn()
}));

jestObj.mock('../../../utils/baseResponseStreamer', () => {
    class BaseResponseStreamer {
        constructor({ response, requestId }) {
            this.response = response;
            this.requestId = requestId;
        }
    }
    return { BaseResponseStreamer };
});

jestObj.mock('../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jestObj.fn((obj) => obj)
    }
}));

jestObj.mock('../../../fhir/serializers/4_0_0/backbone_elements/bundleEntry', () => ({}));

jestObj.mock('../../../utils/contentTypes', () => ({
    fhirContentTypes: {
        ndJson: 'application/fhir+ndjson'
    }
}));

const { FhirResponseNdJsonStreamer } = require('../../../utils/fhirResponseNdJsonStreamer');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');

describe('FhirResponseNdJsonStreamer', () => {
    let streamer;
    let mockResponse;

    beforeEach(() => {
        jestObj.clearAllMocks();

        mockResponse = {
            setHeader: jestObj.fn(),
            write: jestObj.fn().mockResolvedValue(true),
            end: jestObj.fn().mockResolvedValue(true),
            status: jestObj.fn().mockReturnThis()
        };

        streamer = new FhirResponseNdJsonStreamer({
            response: mockResponse,
            requestId: 'req-ndjson-456'
        });
    });

    describe('constructor', () => {
        test('sets _first to true', () => {
            expect(streamer._first).toBe(true);
        });

        test('sets _count to 0', () => {
            expect(streamer._count).toBe(0);
        });

        test('stores response', () => {
            expect(streamer.response).toBe(mockResponse);
        });

        test('stores requestId', () => {
            expect(streamer.requestId).toBe('req-ndjson-456');
        });
    });

    describe('startAsync', () => {
        test('sets Content-Type to application/fhir+ndjson', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/fhir+ndjson');
        });

        test('sets Transfer-Encoding to chunked', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
        });

        test('sets X-Request-ID header', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-ndjson-456');
        });

        test('sets X-Cache to Miss', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'Miss');
        });

        test('converts numeric requestId to string', async () => {
            const numericStreamer = new FhirResponseNdJsonStreamer({
                response: mockResponse,
                requestId: 12345
            });
            await numericStreamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', '12345');
        });
    });

    describe('writeBundleEntryAsync', () => {
        describe('with valid entries', () => {
            test('writes first entry without leading newline', async () => {
                const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient', name: 'John' } };
                await streamer.writeBundleEntryAsync({ bundleEntry });

                const written = mockResponse.write.mock.calls[0][0];
                expect(written).not.toMatch(/^\n/);
                expect(JSON.parse(written)).toEqual({ id: 'p1', resourceType: 'Patient', name: 'John' });
            });

            test('writes second entry with leading newline', async () => {
                const entry1 = { resource: { id: 'p1', resourceType: 'Patient' } };
                const entry2 = { resource: { id: 'p2', resourceType: 'Patient' } };

                await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
                await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });

                const secondWrite = mockResponse.write.mock.calls[1][0];
                expect(secondWrite).toMatch(/^\n/);
                expect(JSON.parse(secondWrite.trim())).toEqual({ id: 'p2', resourceType: 'Patient' });
            });

            test('writes third entry with leading newline', async () => {
                const entry1 = { resource: { id: 'p1', resourceType: 'Patient' } };
                const entry2 = { resource: { id: 'p2', resourceType: 'Patient' } };
                const entry3 = { resource: { id: 'p3', resourceType: 'Patient' } };

                await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
                await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });
                await streamer.writeBundleEntryAsync({ bundleEntry: entry3 });

                const thirdWrite = mockResponse.write.mock.calls[2][0];
                expect(thirdWrite).toMatch(/^\n/);
            });

            test('calls FhirResourceSerializer.serialize on the resource', async () => {
                const resource = { id: 'p1', resourceType: 'Patient' };
                const bundleEntry = { resource };
                await streamer.writeBundleEntryAsync({ bundleEntry });
                expect(FhirResourceSerializer.serialize).toHaveBeenCalledWith(resource);
            });

            test('increments _count for each entry', async () => {
                const entry1 = { resource: { id: 'p1', resourceType: 'Patient' } };
                const entry2 = { resource: { id: 'p2', resourceType: 'Patient' } };

                await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
                expect(streamer._count).toBe(1);

                await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });
                expect(streamer._count).toBe(2);
            });

            test('sets _first to false after first write', async () => {
                const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };
                await streamer.writeBundleEntryAsync({ bundleEntry });
                expect(streamer._first).toBe(false);
            });

            test('outputs valid JSON for each line', async () => {
                const entry = {
                    resource: {
                        id: 'obs-1',
                        resourceType: 'Observation',
                        code: { coding: [{ system: 'http://loinc.org', code: '12345-6' }] }
                    }
                };
                await streamer.writeBundleEntryAsync({ bundleEntry: entry });

                const written = mockResponse.write.mock.calls[0][0];
                const parsed = JSON.parse(written);
                expect(parsed.resourceType).toBe('Observation');
                expect(parsed.code.coding[0].code).toBe('12345-6');
            });
        });

        describe('with null/undefined entries', () => {
            test('does nothing when bundleEntry is null', async () => {
                await streamer.writeBundleEntryAsync({ bundleEntry: null });
                expect(mockResponse.write).not.toHaveBeenCalled();
                expect(streamer._count).toBe(0);
                expect(streamer._first).toBe(true);
            });

            test('does nothing when bundleEntry is undefined', async () => {
                await streamer.writeBundleEntryAsync({ bundleEntry: undefined });
                expect(mockResponse.write).not.toHaveBeenCalled();
                expect(streamer._count).toBe(0);
            });

            test('does nothing when bundleEntry.resource is null', async () => {
                await streamer.writeBundleEntryAsync({ bundleEntry: { resource: null } });
                expect(mockResponse.write).not.toHaveBeenCalled();
                expect(streamer._count).toBe(0);
            });

            test('does nothing when bundleEntry.resource is undefined', async () => {
                await streamer.writeBundleEntryAsync({ bundleEntry: { resource: undefined } });
                expect(mockResponse.write).not.toHaveBeenCalled();
                expect(streamer._count).toBe(0);
            });
        });

        describe('serialization behavior', () => {
            test('serializes resource before writing', async () => {
                FhirResourceSerializer.serialize.mockImplementationOnce((obj) => {
                    obj.serialized = true;
                    return obj;
                });

                const bundleEntry = { resource: { id: 'p1', resourceType: 'Patient' } };
                await streamer.writeBundleEntryAsync({ bundleEntry });

                const written = mockResponse.write.mock.calls[0][0];
                expect(JSON.parse(written).serialized).toBe(true);
            });
        });
    });

    describe('endAsync', () => {
        test('calls response.end with empty string', async () => {
            await streamer.endAsync();
            expect(mockResponse.end).toHaveBeenCalledWith('');
        });

        test('can be called after writing entries', async () => {
            const entry = { resource: { id: 'p1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry: entry });
            await streamer.endAsync();
            expect(mockResponse.end).toHaveBeenCalledWith('');
        });

        test('can be called without writing any entries', async () => {
            await streamer.endAsync();
            expect(mockResponse.end).toHaveBeenCalledWith('');
        });
    });

    describe('ndjson format compliance', () => {
        test('multiple entries produce valid ndjson output', async () => {
            const entries = [
                { resource: { id: 'p1', resourceType: 'Patient' } },
                { resource: { id: 'p2', resourceType: 'Patient' } },
                { resource: { id: 'p3', resourceType: 'Patient' } }
            ];

            for (const entry of entries) {
                await streamer.writeBundleEntryAsync({ bundleEntry: entry });
            }

            // Reconstruct the full output
            const fullOutput = mockResponse.write.mock.calls.map(c => c[0]).join('');
            const lines = fullOutput.split('\n');
            expect(lines).toHaveLength(3);
            lines.forEach((line, index) => {
                const parsed = JSON.parse(line);
                expect(parsed.id).toBe(`p${index + 1}`);
            });
        });
    });
});
