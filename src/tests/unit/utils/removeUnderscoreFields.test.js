'use strict';

const { describe, test, expect } = require('@jest/globals');
const { removeUnderscoreFieldsRecursive } = require('../../../utils/removeUnderscoreFields');

describe('removeUnderscoreFieldsRecursive', () => {
    test('removes top-level underscore fields', () => {
        const obj = { id: '1', _uuid: 'abc', _sourceId: 'def', name: 'test' };
        removeUnderscoreFieldsRecursive(obj);
        expect(obj).toEqual({ id: '1', name: 'test' });
    });

    test('removes nested underscore fields', () => {
        const obj = { meta: { _lastUpdated: '2023', versionId: '1' } };
        removeUnderscoreFieldsRecursive(obj);
        expect(obj).toEqual({ meta: { versionId: '1' } });
    });

    test('processes arrays recursively', () => {
        const obj = { items: [{ _hidden: true, value: 1 }, { _hidden: false, value: 2 }] };
        removeUnderscoreFieldsRecursive(obj);
        expect(obj).toEqual({ items: [{ value: 1 }, { value: 2 }] });
    });

    test('handles deeply nested structures', () => {
        const obj = { a: { b: { c: { _secret: 'x', visible: 'y' } } } };
        removeUnderscoreFieldsRecursive(obj);
        expect(obj.a.b.c).toEqual({ visible: 'y' });
    });

    test('handles null input without throwing', () => {
        expect(() => removeUnderscoreFieldsRecursive(null)).not.toThrow();
    });

    test('handles undefined input without throwing', () => {
        expect(() => removeUnderscoreFieldsRecursive(undefined)).not.toThrow();
    });

    test('handles primitive input without throwing', () => {
        expect(() => removeUnderscoreFieldsRecursive('string')).not.toThrow();
        expect(() => removeUnderscoreFieldsRecursive(42)).not.toThrow();
    });

    test('handles arrays at root level', () => {
        const arr = [{ _a: 1, b: 2 }, { _c: 3, d: 4 }];
        removeUnderscoreFieldsRecursive(arr);
        expect(arr).toEqual([{ b: 2 }, { d: 4 }]);
    });

    test('preserves non-underscore fields completely', () => {
        const obj = { resourceType: 'Patient', id: '123', name: [{ family: 'Smith' }] };
        removeUnderscoreFieldsRecursive(obj);
        expect(obj).toEqual({ resourceType: 'Patient', id: '123', name: [{ family: 'Smith' }] });
    });

    test('mutates the original object', () => {
        const obj = { _remove: true, keep: true };
        removeUnderscoreFieldsRecursive(obj);
        expect(obj._remove).toBeUndefined();
        expect(obj.keep).toBe(true);
    });

    // DCON-4806: _file_id must never be accepted directly from a client -- only
    // DatabaseAttachmentManager may set it, after actually uploading `data` to GridFS.
    // create.js/update.js rely on this general-purpose strip (applied to the raw
    // incoming payload before Resource construction) to remove it, rather than a
    // dedicated _file_id-only helper.
    test('removes a nested _file_id field along with other underscore fields', () => {
        const obj = {
            resourceType: 'DocumentReference',
            content: [{ attachment: { _file_id: 'attacker-chosen-id', contentType: 'application/pdf' } }],
            _uuid: 'client-supplied-uuid'
        };
        removeUnderscoreFieldsRecursive(obj);
        expect(obj.content[0].attachment._file_id).toBeUndefined();
        expect(obj.content[0].attachment.contentType).toBe('application/pdf');
        expect(obj._uuid).toBeUndefined();
    });
});
