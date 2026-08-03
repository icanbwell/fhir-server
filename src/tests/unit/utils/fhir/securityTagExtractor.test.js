'use strict';

const { describe, test, expect } = require('@jest/globals');
const { SecurityTagExtractor } = require('../../../../utils/fhir/securityTagExtractor');

describe('SecurityTagExtractor', () => {
    describe('extractAccessTags', () => {
        test('returns access codes from meta.security', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                        { system: 'https://www.icanbwell.com/access', code: 'client-b' },
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-x' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractAccessTags(resource)).toEqual(['client-a', 'client-b']);
        });

        test('returns empty array when no access tags exist', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-x' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractAccessTags(resource)).toEqual([]);
        });

        test('returns empty array when meta.security is missing', () => {
            expect(SecurityTagExtractor.extractAccessTags({})).toEqual([]);
            expect(SecurityTagExtractor.extractAccessTags({ meta: {} })).toEqual([]);
        });

        test('returns empty array for null/undefined resource', () => {
            expect(SecurityTagExtractor.extractAccessTags(null)).toEqual([]);
            expect(SecurityTagExtractor.extractAccessTags(undefined)).toEqual([]);
        });

        test('filters out tags with null/undefined code', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: null },
                        { system: 'https://www.icanbwell.com/access', code: undefined },
                        { system: 'https://www.icanbwell.com/access', code: 'valid' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractAccessTags(resource)).toEqual(['valid']);
        });

        test('filters out tags with empty string code', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: '' },
                        { system: 'https://www.icanbwell.com/access', code: 'valid' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractAccessTags(resource)).toEqual(['valid']);
        });
    });

    describe('extractOwnerTags', () => {
        test('returns owner codes from meta.security', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-1' },
                        { system: 'https://www.icanbwell.com/access', code: 'access-1' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractOwnerTags(resource)).toEqual(['owner-1']);
        });

        test('returns multiple owner tags', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-1' },
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-2' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractOwnerTags(resource)).toEqual(['owner-1', 'owner-2']);
        });

        test('returns empty array for null resource', () => {
            expect(SecurityTagExtractor.extractOwnerTags(null)).toEqual([]);
        });
    });

    describe('extractSourceAssigningAuthority', () => {
        test('returns source assigning authority code', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'system-abc' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractSourceAssigningAuthority(resource)).toBe('system-abc');
        });

        test('returns null when no sourceAssigningAuthority tag exists', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client-a' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractSourceAssigningAuthority(resource)).toBeNull();
        });

        test('returns null for null/undefined resource', () => {
            expect(SecurityTagExtractor.extractSourceAssigningAuthority(null)).toBeNull();
            expect(SecurityTagExtractor.extractSourceAssigningAuthority(undefined)).toBeNull();
        });

        test('returns first matching tag if multiple exist', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'first' },
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'second' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractSourceAssigningAuthority(resource)).toBe('first');
        });

        test('returns null when code is empty/null', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: '' }
                    ]
                }
            };
            expect(SecurityTagExtractor.extractSourceAssigningAuthority(resource)).toBeNull();
        });
    });

    describe('extractAllTags', () => {
        test('returns all tag categories in correct structure', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-1' },
                        { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'sys-1' }
                    ]
                }
            };
            const result = SecurityTagExtractor.extractAllTags(resource);
            expect(result).toEqual({
                access: ['client-a'],
                owner: ['owner-1'],
                sourceAssigningAuthority: 'sys-1'
            });
        });

        test('returns empty values for resource without security tags', () => {
            const result = SecurityTagExtractor.extractAllTags({});
            expect(result).toEqual({
                access: [],
                owner: [],
                sourceAssigningAuthority: null
            });
        });
    });
});
