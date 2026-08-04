'use strict';

const { describe, test, expect } = require('@jest/globals');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');

const makeParams = (overrides = {}) => ({
    user: 'test-user',
    scope: 'patient/*.read',
    remoteIpAddress: '127.0.0.1',
    requestId: 'req-123',
    userRequestId: 'ureq-456',
    protocol: 'https',
    originalUrl: '/4_0_0/Patient',
    path: '/Patient',
    host: 'fhir.example.com',
    body: null,
    accept: 'application/fhir+json',
    isUser: true,
    userType: 'user',
    personIdFromJwtToken: 'person-1',
    masterPersonIdFromJwtToken: 'master-1',
    managingOrganizationId: 'org-1',
    headers: {},
    method: 'GET',
    contentTypeFromHeader: null,
    alternateUserId: 'alt-1',
    actor: null,
    purposeOfUse: null,
    ...overrides
});

describe('FhirRequestInfo', () => {
    describe('constructor', () => {
        test('stores all properties correctly', () => {
            const info = new FhirRequestInfo(makeParams());
            expect(info.user).toBe('test-user');
            expect(info.scope).toBe('patient/*.read');
            expect(info.remoteIpAddress).toBe('127.0.0.1');
            expect(info.requestId).toBe('req-123');
            expect(info.protocol).toBe('https');
            expect(info.method).toBe('GET');
            expect(info.userType).toBe('user');
        });

        test('throws when user is not a string and not null', () => {
            expect(() => new FhirRequestInfo(makeParams({ user: 123 }))).toThrow(/user is of type/);
        });

        test('throws when user is an object', () => {
            expect(() => new FhirRequestInfo(makeParams({ user: {} }))).toThrow(/user is of type/);
        });

        test('allows null user', () => {
            const info = new FhirRequestInfo(makeParams({ user: null }));
            expect(info.user).toBeNull();
        });

        test('allows undefined user (falsy passes !user check)', () => {
            const info = new FhirRequestInfo(makeParams({ user: undefined }));
            expect(info.user).toBeUndefined();
        });

        test('purposeOfUse defaults to null when not provided', () => {
            const info = new FhirRequestInfo(makeParams({ purposeOfUse: undefined }));
            expect(info.purposeOfUse).toBeNull();
        });

        test('stores purposeOfUse array', () => {
            const info = new FhirRequestInfo(makeParams({ purposeOfUse: ['treatment', 'payment'] }));
            expect(info.purposeOfUse).toEqual(['treatment', 'payment']);
        });

        test('stores actor', () => {
            const actor = { sub: 'actor-1', reference: 'Practitioner/123' };
            const info = new FhirRequestInfo(makeParams({ actor }));
            expect(info.actor).toEqual(actor);
        });
    });

    describe('preferGlobalId', () => {
        test('is true when Prefer header contains global_id=true', () => {
            const info = new FhirRequestInfo(makeParams({
                headers: { Prefer: 'global_id=true' }
            }));
            expect(info.preferGlobalId).toBe(true);
        });

        test('is false when Prefer header is absent', () => {
            const info = new FhirRequestInfo(makeParams({ headers: {} }));
            expect(info.preferGlobalId).toBeFalsy();
        });

        test('is false when Prefer header has global_id=false', () => {
            const info = new FhirRequestInfo(makeParams({
                headers: { Prefer: 'global_id=false' }
            }));
            expect(info.preferGlobalId).toBe(false);
        });

        test('is false when Prefer header has unrelated value', () => {
            const info = new FhirRequestInfo(makeParams({
                headers: { Prefer: 'return=representation' }
            }));
            expect(info.preferGlobalId).toBeFalsy();
        });
    });

    describe('skipCachedData', () => {
        test('returns true when cache-control is no-cache', () => {
            const info = new FhirRequestInfo(makeParams({
                headers: { 'cache-control': 'no-cache' }
            }));
            expect(info.skipCachedData()).toBe(true);
        });

        test('returns false when cache-control is absent', () => {
            const info = new FhirRequestInfo(makeParams({ headers: {} }));
            expect(info.skipCachedData()).toBe(false);
        });

        test('returns false when cache-control has different value', () => {
            const info = new FhirRequestInfo(makeParams({
                headers: { 'cache-control': 'max-age=3600' }
            }));
            expect(info.skipCachedData()).toBe(false);
        });

        test('returns false when headers is empty', () => {
            const info = new FhirRequestInfo(makeParams({ headers: {} }));
            expect(info.skipCachedData()).toBeFalsy();
        });
    });

    describe('externalReqUrlPrefix', () => {
        test('defaults to undefined', () => {
            const info = new FhirRequestInfo(makeParams());
            expect(info.externalReqUrlPrefix).toBeUndefined();
        });

        test('can be set after construction', () => {
            const info = new FhirRequestInfo(makeParams());
            info.externalReqUrlPrefix = 'https://external.service.com';
            expect(info.externalReqUrlPrefix).toBe('https://external.service.com');
        });
    });
});
