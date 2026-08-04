'use strict';

const { describe, test, expect } = require('@jest/globals');
const { removeUnderscoreFieldsRecursive, removeFileIdFieldRecursive } = require('../../../utils/removeUnderscoreFields');

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
});

// DCON-4806: _file_id must never be accepted directly from a client -- only
// DatabaseAttachmentManager may set it, after actually uploading `data` to GridFS.
describe('removeFileIdFieldRecursive', () => {
    test('removes a top-level _file_id field', () => {
        const obj = { _file_id: 'abc123', data: 'somedata' };
        removeFileIdFieldRecursive(obj);
        expect(obj).toEqual({ data: 'somedata' });
    });

    test('removes a nested _file_id field but leaves other underscore fields alone', () => {
        const obj = {
            resourceType: 'DocumentReference',
            content: [{ attachment: { _file_id: 'attacker-chosen-id', contentType: 'application/pdf' } }],
            _uuid: 'keep-me'
        };
        removeFileIdFieldRecursive(obj);
        expect(obj.content[0].attachment._file_id).toBeUndefined();
        expect(obj.content[0].attachment.contentType).toBe('application/pdf');
        expect(obj._uuid).toBe('keep-me');
    });

    test('processes arrays recursively', () => {
        const obj = { items: [{ _file_id: 'a' }, { _file_id: 'b', keep: true }] };
        removeFileIdFieldRecursive(obj);
        expect(obj).toEqual({ items: [{}, { keep: true }] });
    });

    test('handles null/undefined/primitive input without throwing', () => {
        expect(() => removeFileIdFieldRecursive(null)).not.toThrow();
        expect(() => removeFileIdFieldRecursive(undefined)).not.toThrow();
        expect(() => removeFileIdFieldRecursive('string')).not.toThrow();
    });

    test('leaves an object with no _file_id field unchanged', () => {
        const obj = { resourceType: 'Patient', id: '123' };
        removeFileIdFieldRecursive(obj);
        expect(obj).toEqual({ resourceType: 'Patient', id: '123' });
    });
});
