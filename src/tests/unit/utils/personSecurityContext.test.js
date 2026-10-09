const { describe, test, expect } = require('@jest/globals');
const {
    getPersonProxyReference,
    getSecurityContextReference,
    hasOwnPersonSecurityContext,
    stampPersonSecurityContext
} = require('../../../utils/personSecurityContext');

const newBinary = (securityContext) => ({
    resourceType: 'Binary',
    contentType: 'application/pdf',
    data: 'AAAA',
    ...(securityContext !== undefined ? { securityContext } : {})
});

describe('personSecurityContext', () => {
    describe('getPersonProxyReference', () => {
        test('is the proxy patient reference used for a person today', () => {
            expect(getPersonProxyReference('abc-123')).toBe('Patient/person.abc-123');
        });
    });

    describe('getSecurityContextReference', () => {
        test('returns undefined without a securityContext', () => {
            expect(getSecurityContextReference(undefined)).toBeUndefined();
            expect(getSecurityContextReference({})).toBeUndefined();
            expect(getSecurityContextReference({ securityContext: null })).toBeUndefined();
        });

        test('returns the reference, falling back to the stored _sourceId', () => {
            expect(getSecurityContextReference(newBinary({ reference: 'Patient/1' }))).toBe('Patient/1');
            expect(getSecurityContextReference(newBinary({ _sourceId: 'Patient/2' }))).toBe('Patient/2');
        });
    });

    describe('hasOwnPersonSecurityContext', () => {
        test('true for the caller\'s own proxy-patient reference, with or without a source assigning authority', () => {
            expect(hasOwnPersonSecurityContext(newBinary({ reference: 'Patient/person.A' }), 'A')).toBe(true);
            expect(hasOwnPersonSecurityContext(newBinary({ reference: 'Patient/person.A|client1' }), 'A')).toBe(true);
            expect(hasOwnPersonSecurityContext(newBinary({ _sourceId: 'Patient/person.A' }), 'A')).toBe(true);
        });

        test('false for another person, a real patient, another resource type, or nothing', () => {
            expect(hasOwnPersonSecurityContext(newBinary({ reference: 'Patient/person.B' }), 'A')).toBe(false);
            expect(hasOwnPersonSecurityContext(newBinary({ reference: 'Patient/A' }), 'A')).toBe(false);
            expect(hasOwnPersonSecurityContext(newBinary({ reference: 'Person/A' }), 'A')).toBe(false);
            expect(hasOwnPersonSecurityContext(newBinary({ reference: 'Patient/person.AB' }), 'A')).toBe(false);
            expect(hasOwnPersonSecurityContext(newBinary({}), 'A')).toBe(false);
            expect(hasOwnPersonSecurityContext(newBinary(), 'A')).toBe(false);
        });

        test('false without a usable person id', () => {
            for (const personId of [undefined, null, '', 42]) {
                expect(hasOwnPersonSecurityContext(newBinary({ reference: 'Patient/person.A' }), personId)).toBe(false);
            }
        });
    });

    describe('stampPersonSecurityContext', () => {
        const forbidden = (fn) => {
            let error;
            try {
                fn();
            } catch (e) {
                error = e;
            }
            expect(error).toBeDefined();
            expect(error.statusCode).toBe(403);
            return error;
        };

        test('sets the caller\'s proxy patient when none is supplied', () => {
            const resource = stampPersonSecurityContext({ resource: newBinary(), personId: 'A' });
            expect(resource.securityContext).toEqual({ reference: 'Patient/person.A' });
        });

        test('also sets it over an explicit null', () => {
            const resource = stampPersonSecurityContext({ resource: newBinary(null), personId: 'A' });
            expect(resource.securityContext).toEqual({ reference: 'Patient/person.A' });
        });

        test('accepts the caller\'s own reference unchanged (idempotent)', () => {
            const resource = stampPersonSecurityContext({
                resource: newBinary({ reference: 'Patient/person.A' }), personId: 'A'
            });
            expect(resource.securityContext).toEqual({ reference: 'Patient/person.A' });
        });

        test('rejects another person with 403 and a reason, without echoing the supplied value', () => {
            const resource = newBinary({ reference: 'Patient/person.SECRET-B' });
            const error = forbidden(() => stampPersonSecurityContext({ resource, personId: 'A' }));
            expect(error.message).toContain('securityContext');
            expect(error.message).toContain('cannot be supplied by the client');
            expect(error.message).not.toContain('SECRET-B');
            expect(resource.securityContext).toEqual({ reference: 'Patient/person.SECRET-B' });
        });

        test('rejects a real Patient, another resource type, or a reference-less securityContext', () => {
            for (const securityContext of [
                { reference: 'Patient/some-patient' },
                { reference: 'Organization/o1' },
                { display: 'x' }
            ]) {
                forbidden(() => stampPersonSecurityContext({ resource: newBinary(securityContext), personId: 'A' }));
            }
        });

        test.each([undefined, null, '', 7])('rejects a missing person id (%p) with 403', (personId) => {
            forbidden(() => stampPersonSecurityContext({ resource: newBinary(), personId }));
        });
    });
});
