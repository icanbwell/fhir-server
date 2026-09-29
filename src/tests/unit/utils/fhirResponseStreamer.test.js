'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg || 'assertIsValid failed'); })
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

jestObj.mock('../../../fhir/classes/4_0_0/resources/bundle', () => {
    return class Bundle {};
});

jestObj.mock('../../../fhir/fhirResourceSerializer', () => ({
    FhirResourceSerializer: {
        serialize: jestObj.fn((obj, _serializer) => obj)
    }
}));

jestObj.mock('../../../fhir/serializers/4_0_0/backbone_elements/bundleEntry', () => ({}));
jestObj.mock('../../../fhir/serializers/4_0_0/resources/bundle', () => ({}));

const { FhirResponseStreamer } = require('../../../utils/fhirResponseStreamer');

describe('FhirResponseStreamer', () => {
    let streamer;
    let mockResponse;

    beforeEach(() => {
        mockResponse = {
            setHeader: jestObj.fn(),
            write: jestObj.fn().mockResolvedValue(true),
            end: jestObj.fn().mockResolvedValue(true),
            status: jestObj.fn()
        };
        streamer = new FhirResponseStreamer({
            response: mockResponse,
            requestId: 'req-123',
            bundleType: 'searchset'
        });
    });

    describe('constructor', () => {
        test('sets _first to true', () => {
            expect(streamer._first).toBe(true);
        });

        test('sets _lastid to null', () => {
            expect(streamer._lastid).toBeNull();
        });

        test('sets _count to 0', () => {
            expect(streamer._count).toBe(0);
        });

        test('sets _bundleType from parameter', () => {
            expect(streamer._bundleType).toBe('searchset');
        });

        test('sets _bundle to null', () => {
            expect(streamer._bundle).toBeNull();
        });

        test('defaults bundleType to searchset when not provided', () => {
            const s = new FhirResponseStreamer({
                response: mockResponse,
                requestId: 'req-456'
            });
            expect(s._bundleType).toBe('searchset');
        });

        test('stores response from constructor', () => {
            expect(streamer.response).toBe(mockResponse);
        });

        test('stores requestId from constructor', () => {
            expect(streamer.requestId).toBe('req-123');
        });
    });

    describe('startAsync', () => {
        test('sets Content-Type to application/fhir+json', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/fhir+json');
        });

        test('sets Transfer-Encoding to chunked', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
        });

        test('sets X-Request-ID header', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-123');
        });

        test('sets X-Cache to Miss', async () => {
            await streamer.startAsync();
            expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Cache', 'Miss');
        });
    });

    describe('writeBundleEntryAsync', () => {
        test('writes beginning JSON with first entry', async () => {
            const bundleEntry = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry });
            const written = mockResponse.write.mock.calls[0][0];
            expect(written).toMatch(/^\{"entry":\[/);
        });

        test('does not include leading comma for first entry', async () => {
            const bundleEntry = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry });
            const written = mockResponse.write.mock.calls[0][0];
            expect(written.startsWith(',')).toBe(false);
        });

        test('includes comma separator for subsequent entries', async () => {
            const entry1 = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            const entry2 = { resource: { id: 'patient-2', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
            await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });
            const secondWrite = mockResponse.write.mock.calls[1][0];
            expect(secondWrite.startsWith(',')).toBe(true);
        });

        test('increments count', async () => {
            const bundleEntry = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry });
            expect(streamer._count).toBe(1);
        });

        test('increments count for each entry', async () => {
            const entry1 = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            const entry2 = { resource: { id: 'patient-2', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry: entry1 });
            await streamer.writeBundleEntryAsync({ bundleEntry: entry2 });
            expect(streamer._count).toBe(2);
        });

        test('updates _lastid', async () => {
            const bundleEntry = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry });
            expect(streamer._lastid).toBe('patient-1');
        });

        test('does nothing when bundleEntry is null', async () => {
            await streamer.writeBundleEntryAsync({ bundleEntry: null });
            expect(mockResponse.write).not.toHaveBeenCalled();
            expect(streamer._count).toBe(0);
        });

        test('does nothing when bundleEntry is undefined', async () => {
            await streamer.writeBundleEntryAsync({ bundleEntry: undefined });
            expect(mockResponse.write).not.toHaveBeenCalled();
            expect(streamer._count).toBe(0);
        });

        test('throws when bundleEntry has no resource', async () => {
            const bundleEntry = { id: 'no-resource' };
            await expect(streamer.writeBundleEntryAsync({ bundleEntry }))
                .rejects.toThrow(/BundleEntry does not have a resource element/);
        });

        test('sets _first to false after first write', async () => {
            const bundleEntry = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry });
            expect(streamer._first).toBe(false);
        });
    });

    describe('setBundle', () => {
        test('stores the bundle', () => {
            const bundle = { id: 'bundle-1', type: 'searchset', resourceType: 'Bundle' };
            streamer.setBundle({ bundle });
            expect(streamer._bundle).toBe(bundle);
        });
    });

    describe('endAsync', () => {
        test('writes beginning JSON if no entries were written', async () => {
            await streamer.endAsync();
            expect(mockResponse.write).toHaveBeenCalledWith('{"entry":[');
        });

        test('ends response with closing bracket and bundle properties', async () => {
            await streamer.endAsync();
            const endArg = mockResponse.end.mock.calls[0][0];
            expect(endArg).toMatch(/^\],/);
        });

        test('includes total count of 0 when no entries', async () => {
            await streamer.endAsync();
            const endArg = mockResponse.end.mock.calls[0][0];
            expect(endArg).toContain('"total":0');
        });

        test('includes correct total after writing entries', async () => {
            const entry = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry: entry });
            await streamer.writeBundleEntryAsync({ bundleEntry: entry });
            await streamer.endAsync();
            const endArg = mockResponse.end.mock.calls[0][0];
            expect(endArg).toContain('"total":2');
        });

        test('does not write beginning JSON if entries were already written', async () => {
            const entry = { resource: { id: 'patient-1', resourceType: 'Patient' } };
            await streamer.writeBundleEntryAsync({ bundleEntry: entry });
            mockResponse.write.mockClear();
            await streamer.endAsync();
            // write should not be called again for beginning JSON
            expect(mockResponse.write).not.toHaveBeenCalled();
        });

        test('uses provided bundle when set', async () => {
            const bundle = { id: 'custom-bundle', type: 'history', resourceType: 'Bundle', link: [] };
            streamer.setBundle({ bundle });
            await streamer.endAsync();
            const endArg = mockResponse.end.mock.calls[0][0];
            expect(endArg).toContain('"id":"custom-bundle"');
        });

        test('uses empty bundle when no bundle is set', async () => {
            await streamer.endAsync();
            const endArg = mockResponse.end.mock.calls[0][0];
            expect(endArg).toContain('"id":"req-123"');
            expect(endArg).toContain('"type":"searchset"');
            expect(endArg).toContain('"resourceType":"Bundle"');
        });

        test('includes timestamp in empty bundle', async () => {
            await streamer.endAsync();
            const endArg = mockResponse.end.mock.calls[0][0];
            expect(endArg).toContain('"timestamp"');
        });
    });
});
