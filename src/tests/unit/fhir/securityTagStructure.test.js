const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { SecurityTagStructure } = require('../../../fhir/securityTagStructure');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

describe('SecurityTagStructure', () => {
    describe('constructor', () => {
        test('sets all properties from constructor args', () => {
            const struct = new SecurityTagStructure({
                owner: ['owner1'],
                access: ['access1'],
                vendor: ['vendor1'],
                sourceAssigningAuthority: ['saa1']
            });
            expect(struct.owner).toEqual(['owner1']);
            expect(struct.access).toEqual(['access1']);
            expect(struct.vendor).toEqual(['vendor1']);
            expect(struct.sourceAssigningAuthority).toEqual(['saa1']);
        });

        test('defaults sourceAssigningAuthority to owner when undefined', () => {
            const struct = new SecurityTagStructure({
                owner: ['owner-a', 'owner-b'],
                access: ['access1'],
                vendor: ['vendor1'],
                sourceAssigningAuthority: undefined
            });
            expect(struct.sourceAssigningAuthority).toEqual(['owner-a', 'owner-b']);
        });

        test('defaults sourceAssigningAuthority to owner when empty array', () => {
            const struct = new SecurityTagStructure({
                owner: ['owner-x'],
                access: ['access1'],
                vendor: [],
                sourceAssigningAuthority: []
            });
            expect(struct.sourceAssigningAuthority).toEqual(['owner-x']);
        });

        test('keeps sourceAssigningAuthority when provided with values', () => {
            const struct = new SecurityTagStructure({
                owner: ['owner-1'],
                access: [],
                vendor: [],
                sourceAssigningAuthority: ['saa-explicit']
            });
            expect(struct.sourceAssigningAuthority).toEqual(['saa-explicit']);
        });
    });

    describe('matchesOnSourceAssigningAuthority', () => {
        test('returns true when there is a matching sourceAssigningAuthority', () => {
            const struct1 = new SecurityTagStructure({
                owner: ['owner1'],
                access: [],
                vendor: [],
                sourceAssigningAuthority: ['saa-shared', 'saa-unique1']
            });
            const struct2 = new SecurityTagStructure({
                owner: ['owner2'],
                access: [],
                vendor: [],
                sourceAssigningAuthority: ['saa-shared', 'saa-unique2']
            });
            expect(struct1.matchesOnSourceAssigningAuthority({ other: struct2 })).toBe(true);
        });

        test('returns false when no sourceAssigningAuthority overlaps', () => {
            const struct1 = new SecurityTagStructure({
                owner: ['owner1'],
                access: [],
                vendor: [],
                sourceAssigningAuthority: ['saa-a']
            });
            const struct2 = new SecurityTagStructure({
                owner: ['owner2'],
                access: [],
                vendor: [],
                sourceAssigningAuthority: ['saa-b']
            });
            expect(struct1.matchesOnSourceAssigningAuthority({ other: struct2 })).toBe(false);
        });

        test('uses owner as sourceAssigningAuthority when saa is empty', () => {
            const struct1 = new SecurityTagStructure({
                owner: ['shared-owner'],
                access: [],
                vendor: [],
                sourceAssigningAuthority: []
            });
            const struct2 = new SecurityTagStructure({
                owner: ['shared-owner'],
                access: [],
                vendor: [],
                sourceAssigningAuthority: []
            });
            // Both default to owner, so they match
            expect(struct1.matchesOnSourceAssigningAuthority({ other: struct2 })).toBe(true);
        });

        test('returns true for partial overlap in multiple values', () => {
            const struct1 = new SecurityTagStructure({
                owner: [],
                access: [],
                vendor: [],
                sourceAssigningAuthority: ['a', 'b', 'c']
            });
            const struct2 = new SecurityTagStructure({
                owner: [],
                access: [],
                vendor: [],
                sourceAssigningAuthority: ['x', 'y', 'c']
            });
            expect(struct1.matchesOnSourceAssigningAuthority({ other: struct2 })).toBe(true);
        });
    });

    describe('fromDocument', () => {
        test('extracts all security tag types from document', () => {
            const doc = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'owner-code' },
                        { system: SecurityTagSystem.access, code: 'access-code' },
                        { system: SecurityTagSystem.vendor, code: 'vendor-code' },
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'saa-code' }
                    ]
                }
            };
            const struct = SecurityTagStructure.fromDocument({ doc });
            expect(struct.owner).toEqual(['owner-code']);
            expect(struct.access).toEqual(['access-code']);
            expect(struct.vendor).toEqual(['vendor-code']);
            expect(struct.sourceAssigningAuthority).toEqual(['saa-code']);
        });

        test('handles multiple tags of same system', () => {
            const doc = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'access-1' },
                        { system: SecurityTagSystem.access, code: 'access-2' },
                        { system: SecurityTagSystem.owner, code: 'owner-1' }
                    ]
                }
            };
            const struct = SecurityTagStructure.fromDocument({ doc });
            expect(struct.access).toEqual(['access-1', 'access-2']);
            expect(struct.owner).toEqual(['owner-1']);
        });

        test('returns empty arrays when doc has no meta', () => {
            const doc = {};
            const struct = SecurityTagStructure.fromDocument({ doc });
            expect(struct.owner).toEqual([]);
            expect(struct.access).toEqual([]);
            expect(struct.vendor).toEqual([]);
            // sourceAssigningAuthority defaults to owner which is empty
            expect(struct.sourceAssigningAuthority).toEqual([]);
        });

        test('returns empty arrays when doc has no security in meta', () => {
            const doc = { meta: {} };
            const struct = SecurityTagStructure.fromDocument({ doc });
            expect(struct.owner).toEqual([]);
            expect(struct.access).toEqual([]);
            expect(struct.vendor).toEqual([]);
        });

        test('filters by correct system URIs', () => {
            const doc = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'correct-owner' },
                        { system: 'https://other-system.com/owner', code: 'wrong-owner' },
                        { system: 'https://www.icanbwell.com/access', code: 'correct-access' }
                    ]
                }
            };
            const struct = SecurityTagStructure.fromDocument({ doc });
            expect(struct.owner).toEqual(['correct-owner']);
            expect(struct.access).toEqual(['correct-access']);
        });

        test('defaults sourceAssigningAuthority to owner when not present in tags', () => {
            const doc = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'owner-val' }
                    ]
                }
            };
            const struct = SecurityTagStructure.fromDocument({ doc });
            expect(struct.sourceAssigningAuthority).toEqual(['owner-val']);
        });
    });

    describe('fromResource', () => {
        test('delegates to fromDocument with the resource as doc', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'res-owner' },
                        { system: SecurityTagSystem.access, code: 'res-access' }
                    ]
                }
            };
            const struct = SecurityTagStructure.fromResource({ resource });
            expect(struct.owner).toEqual(['res-owner']);
            expect(struct.access).toEqual(['res-access']);
        });
    });
});
