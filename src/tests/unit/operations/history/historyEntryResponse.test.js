const { describe, test, expect } = require('@jest/globals');
const { ensureHistoryEntryResponse } = require('../../../../operations/history/historyEntryResponse');

describe('ensureHistoryEntryResponse', () => {
    const resource = { resourceType: 'Patient', id: '1', meta: { versionId: '3', lastUpdated: '2023-02-16T01:12:00.000Z' } };

    test.each([
        ['POST', '201 Created'],
        ['PUT', '200 OK'],
        ['PATCH', '200 OK'],
        ['DELETE', '204 No Content'],
        ['put', '200 OK'],
        ['GET', '200 OK']
    ])('maps %s to %s', (method, status) => {
        const entry = ensureHistoryEntryResponse({ resource, request: { method, url: '/4_0_0/Patient/1' } });
        expect(entry.response.status).toBe(status);
        expect(entry.response.etag).toBe('W/"3"');
        expect(entry.response.lastModified).toBe('2023-02-16T01:12:00.000Z');
    });

    test('falls back to 200 OK without request and omits etag/lastModified without meta', () => {
        const entry = ensureHistoryEntryResponse({ resource: { resourceType: 'Patient', id: '1' } });
        expect(entry.response).toEqual({ status: '200 OK' });
    });

    test('never overwrites an existing response', () => {
        const existing = { status: '200', outcome: { resourceType: 'OperationOutcome', issue: [] } };
        const entry = ensureHistoryEntryResponse({ resource, request: { method: 'POST' }, response: existing });
        expect(entry.response).toBe(existing);
    });
});
