const { describe, test, expect } = require('@jest/globals');
const { isNotSystemCollection } = require('../../../utils/mongoDBUtils');

describe('mongoDBUtils', () => {
    describe('isNotSystemCollection', () => {
        test('returns true for a regular collection name', () => {
            expect(isNotSystemCollection('Patient_4_0_0')).toBe(true);
        });

        test('returns true for another regular collection name', () => {
            expect(isNotSystemCollection('Observation_4_0_0')).toBe(true);
        });

        test('returns true for a collection name with underscores', () => {
            expect(isNotSystemCollection('my_custom_collection')).toBe(true);
        });

        test('returns false for system.indexes collection', () => {
            expect(isNotSystemCollection('system.indexes')).toBe(false);
        });

        test('returns false for system.profile collection', () => {
            expect(isNotSystemCollection('system.profile')).toBe(false);
        });

        test('returns false for system.users collection', () => {
            expect(isNotSystemCollection('system.users')).toBe(false);
        });

        test('returns false for system.namespaces collection', () => {
            expect(isNotSystemCollection('system.namespaces')).toBe(false);
        });

        test('returns false for fs.files collection', () => {
            expect(isNotSystemCollection('fs.files')).toBe(false);
        });

        test('returns false for fs.chunks collection', () => {
            expect(isNotSystemCollection('fs.chunks')).toBe(false);
        });

        test('returns false for collection containing system. in name', () => {
            expect(isNotSystemCollection('prefix_system.something')).toBe(false);
        });

        test('returns false for collection containing fs.files in name', () => {
            expect(isNotSystemCollection('prefix_fs.files_suffix')).toBe(false);
        });

        test('returns false for collection containing fs.chunks in name', () => {
            expect(isNotSystemCollection('prefix_fs.chunks_suffix')).toBe(false);
        });

        test('returns true for a collection that starts with "sys" but is not system.', () => {
            expect(isNotSystemCollection('syslog')).toBe(true);
        });

        test('returns true for a collection named "filesystem"', () => {
            expect(isNotSystemCollection('filesystem')).toBe(true);
        });

        test('returns true for an empty string', () => {
            expect(isNotSystemCollection('')).toBe(true);
        });

        test('returns true for a collection with "fs" but not "fs.files" or "fs.chunks"', () => {
            expect(isNotSystemCollection('fs_data')).toBe(true);
        });

        test('returns true for collection named "systems"', () => {
            // "systems" does not contain "system." (with the dot)
            expect(isNotSystemCollection('systems')).toBe(true);
        });
    });
});
