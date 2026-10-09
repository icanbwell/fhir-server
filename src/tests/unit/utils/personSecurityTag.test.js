const { describe, test, expect } = require('@jest/globals');
const {
    getPersonTagCodes,
    hasOwnPersonTagOnly,
    stampPersonTag
} = require('../../../utils/personSecurityTag');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

const ownerTag = { system: SecurityTagSystem.owner, code: 'client' };
const accessTag = { system: SecurityTagSystem.access, code: 'client' };
const personTag = (code) => ({ system: SecurityTagSystem.clientPersonId, code });

const newBinary = (security) => ({
    resourceType: 'Binary',
    contentType: 'application/pdf',
    data: 'AAAA',
    ...(security ? { meta: { security } } : {})
});

describe('personSecurityTag', () => {
    describe('getPersonTagCodes', () => {
        test('returns [] when there is no meta or no security', () => {
            expect(getPersonTagCodes(undefined)).toEqual([]);
            expect(getPersonTagCodes({})).toEqual([]);
            expect(getPersonTagCodes({ meta: {} })).toEqual([]);
            expect(getPersonTagCodes({ meta: { security: 'x' } })).toEqual([]);
        });

        test('returns only the clientPersonId codes', () => {
            expect(getPersonTagCodes(newBinary([ownerTag, accessTag, personTag('A')]))).toEqual(['A']);
            expect(getPersonTagCodes(newBinary([personTag('A'), personTag('B')]))).toEqual(['A', 'B']);
        });
    });

    describe('hasOwnPersonTagOnly', () => {
        test('true only for exactly one tag equal to the person id', () => {
            expect(hasOwnPersonTagOnly(newBinary([personTag('A')]), 'A')).toBe(true);
            expect(hasOwnPersonTagOnly(newBinary([ownerTag, personTag('A')]), 'A')).toBe(true);
        });

        test('false for no tag, another person, duplicate tags, or a missing/empty person id', () => {
            expect(hasOwnPersonTagOnly(newBinary([ownerTag]), 'A')).toBe(false);
            expect(hasOwnPersonTagOnly(newBinary([personTag('B')]), 'A')).toBe(false);
            expect(hasOwnPersonTagOnly(newBinary([personTag('A'), personTag('A')]), 'A')).toBe(false);
            expect(hasOwnPersonTagOnly(newBinary([personTag('A')]), undefined)).toBe(false);
            expect(hasOwnPersonTagOnly(newBinary([personTag('A')]), '')).toBe(false);
            expect(hasOwnPersonTagOnly(newBinary([personTag('A')]), 42)).toBe(false);
        });
    });

    describe('stampPersonTag', () => {
        test('appends the tag when none is supplied (no meta at all)', () => {
            const resource = stampPersonTag({ resource: newBinary(), personId: 'A' });
            expect(resource.meta.security).toEqual([personTag('A')]);
        });

        test('appends the tag next to the owner/access tags the client supplied', () => {
            const resource = stampPersonTag({ resource: newBinary([ownerTag, accessTag]), personId: 'A' });
            expect(resource.meta.security).toEqual([ownerTag, accessTag, personTag('A')]);
        });

        test('creates security when meta exists without it', () => {
            const resource = newBinary();
            resource.meta = { source: 'x' };
            stampPersonTag({ resource, personId: 'A' });
            expect(resource.meta.security).toEqual([personTag('A')]);
        });

        test('accepts one matching tag unchanged (idempotent)', () => {
            const resource = stampPersonTag({ resource: newBinary([ownerTag, personTag('A')]), personId: 'A' });
            expect(resource.meta.security).toEqual([ownerTag, personTag('A')]);
        });

        test('rejects a tag for a different person with 403 and a reason, without echoing the other id', () => {
            let error;
            try {
                stampPersonTag({ resource: newBinary([personTag('SECRET-B')]), personId: 'A' });
            } catch (e) {
                error = e;
            }
            expect(error).toBeDefined();
            expect(error.statusCode).toBe(403);
            expect(error.message).toContain(SecurityTagSystem.clientPersonId);
            expect(error.message).toContain('does not match');
            expect(error.message).not.toContain('SECRET-B');
        });

        test('rejects more than one clientPersonId tag with 400', () => {
            let error;
            try {
                stampPersonTag({ resource: newBinary([personTag('A'), personTag('A')]), personId: 'A' });
            } catch (e) {
                error = e;
            }
            expect(error).toBeDefined();
            expect(error.statusCode).toBe(400);
        });

        test.each([undefined, null, '', 7])('rejects a missing person id (%p) with 403', (personId) => {
            let error;
            try {
                stampPersonTag({ resource: newBinary(), personId });
            } catch (e) {
                error = e;
            }
            expect(error).toBeDefined();
            expect(error.statusCode).toBe(403);
        });

        test('does not stamp when rejecting', () => {
            const resource = newBinary([personTag('B')]);
            expect(() => stampPersonTag({ resource, personId: 'A' })).toThrow();
            expect(resource.meta.security).toEqual([personTag('B')]);
        });
    });
});
