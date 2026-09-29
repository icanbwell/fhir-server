const { describe, test, expect } = require('@jest/globals');
const { buildBulkWriteRequestContext } = require('../../../dataLayer/bulkWriteRequestContext');
const { FhirRequestInfo } = require('../../../utils/fhirRequestInfo');

describe('buildBulkWriteRequestContext', () => {
    function createFullRequestInfo() {
        return new FhirRequestInfo({
            requestId: 'req-12345',
            user: 'admin-user',
            scope: 'patient/*.read user/*.write',
            remoteIpAddress: '192.168.1.100',
            protocol: 'https',
            originalUrl: '/4_0_0/Patient/123',
            path: '/Patient/123',
            host: 'fhir.example.com',
            body: { resourceType: 'Patient', id: '123', name: [{ given: ['John'] }] },
            accept: 'application/fhir+json',
            isUser: true,
            userType: 'practitioner',
            userRequestId: 'user-req-abc',
            method: 'PUT',
            personIdFromJwtToken: 'person-456',
            masterPersonIdFromJwtToken: 'master-789',
            managingOrganizationId: 'org-100',
            headers: { 'Content-Type': 'application/fhir+json', Prefer: 'return=representation' },
            contentTypeFromHeader: { type: 'application/fhir+json' },
            alternateUserId: 'alt-user-1',
            actor: { sub: 'actor-sub', reference: 'Practitioner/prac-1' },
            purposeOfUse: ['TREAT']
        });
    }

    test('should return a FhirRequestInfo instance', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result).toBeInstanceOf(FhirRequestInfo);
    });

    test('should preserve requestId from original request', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.requestId).toBe('req-12345');
    });

    test('should set headers to empty object', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.headers).toEqual({});
    });

    test('should null out user to release memory', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.user).toBeNull();
    });

    test('should null out scope', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.scope).toBeNull();
    });

    test('should null out remoteIpAddress', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.remoteIpAddress).toBeNull();
    });

    test('should null out protocol', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.protocol).toBeNull();
    });

    test('should null out originalUrl', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.originalUrl).toBeNull();
    });

    test('should null out path', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.path).toBeNull();
    });

    test('should null out host', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.host).toBeNull();
    });

    test('should null out body to release potentially large request payloads', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.body).toBeNull();
    });

    test('should null out accept', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.accept).toBeNull();
    });

    test('should null out isUser', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.isUser).toBeNull();
    });

    test('should null out userType', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.userType).toBeNull();
    });

    test('should null out userRequestId', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.userRequestId).toBeNull();
    });

    test('should null out method', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.method).toBeNull();
    });

    test('should null out personIdFromJwtToken', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.personIdFromJwtToken).toBeNull();
    });

    test('should null out masterPersonIdFromJwtToken', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.masterPersonIdFromJwtToken).toBeNull();
    });

    test('should null out managingOrganizationId', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.managingOrganizationId).toBeNull();
    });

    test('should null out contentTypeFromHeader', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.contentTypeFromHeader).toBeNull();
    });

    test('should null out alternateUserId', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.alternateUserId).toBeNull();
    });

    test('should null out actor', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.actor).toBeNull();
    });

    test('should null out purposeOfUse', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.purposeOfUse).toBeNull();
    });

    test('should not set preferGlobalId since headers is empty', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.preferGlobalId).toBeFalsy();
    });

    test('should work with minimal requestInfo containing only requestId', () => {
        const requestInfo = new FhirRequestInfo({
            requestId: 'minimal-req-id',
            user: null,
            scope: null,
            remoteIpAddress: null,
            protocol: null,
            originalUrl: null,
            path: null,
            host: null,
            body: null,
            accept: null,
            isUser: null,
            userType: null,
            userRequestId: null,
            method: null,
            personIdFromJwtToken: null,
            masterPersonIdFromJwtToken: null,
            managingOrganizationId: null,
            headers: {},
            contentTypeFromHeader: null,
            alternateUserId: null,
            actor: null,
            purposeOfUse: null
        });

        const result = buildBulkWriteRequestContext(requestInfo);
        expect(result.requestId).toBe('minimal-req-id');
    });

    test('should produce independent object not referencing original requestInfo', () => {
        const requestInfo = createFullRequestInfo();
        const result = buildBulkWriteRequestContext(requestInfo);

        // Modify original - should not affect result
        requestInfo.requestId = 'modified-id';
        expect(result.requestId).toBe('req-12345');
    });
});
