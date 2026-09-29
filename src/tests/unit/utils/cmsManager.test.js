'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { CMSManager } = require('../../../utils/cmsManager');
const { AUTH_USER_TYPES, CMS_PARTNER_ACCESS, PERSON_PROXY_PREFIX } = require('../../../constants');

describe('CMSManager', () => {
    let cmsManager;
    let mockConfigManager;

    beforeEach(() => {
        mockConfigManager = {
            cmsAllowedPurposeOfUse: new Set(['treatment', 'payment'])
        };
        cmsManager = new CMSManager({ configManager: mockConfigManager });
    });

    describe('isCmsPartnerUser', () => {
        test('returns true for cmsPartnerUser type', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(cmsManager.isCmsPartnerUser(requestInfo)).toBe(true);
        });

        test('returns false for other user types', () => {
            expect(cmsManager.isCmsPartnerUser({ userType: 'user' })).toBe(false);
            expect(cmsManager.isCmsPartnerUser({ userType: 'practitioner' })).toBe(false);
        });

        test('returns false for null/undefined requestInfo', () => {
            expect(cmsManager.isCmsPartnerUser(null)).toBe(false);
            expect(cmsManager.isCmsPartnerUser(undefined)).toBe(false);
        });
    });

    describe('verifyAccess', () => {
        const makeCmsRequest = (overrides = {}) => ({
            userType: AUTH_USER_TYPES.cmsPartnerUser,
            purposeOfUse: ['treatment'],
            method: 'get',
            user: 'cms-user-1',
            requestId: 'req-1',
            ...overrides
        });

        test('does nothing for non-CMS users', () => {
            expect(() => cmsManager.verifyAccess({
                requestInfo: { userType: 'user', method: 'delete' },
                resourceType: 'AnyResource',
                operation: 'delete'
            })).not.toThrow();
        });

        test('throws ForbiddenError for disallowed HTTP method', () => {
            const requestInfo = makeCmsRequest({ method: 'delete' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have access to DELETE method/);
        });

        test('throws ForbiddenError for disallowed resource type', () => {
            const requestInfo = makeCmsRequest({ method: 'get' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: 'Organization',
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have access to Organization/);
        });

        test('throws ForbiddenError for disallowed operation', () => {
            const requestInfo = makeCmsRequest({ method: 'get' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: 'delete'
            })).toThrow(/does not have access to/);
        });

        test('throws ForbiddenError when purposeOfUse is invalid', () => {
            const requestInfo = makeCmsRequest({ purposeOfUse: ['marketing'] });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have valid permission/);
        });

        test('throws ForbiddenError when purposeOfUse is empty array', () => {
            const requestInfo = makeCmsRequest({ purposeOfUse: [] });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have valid permission/);
        });

        test('throws ForbiddenError when purposeOfUse is not an array', () => {
            const requestInfo = makeCmsRequest({ purposeOfUse: 'treatment' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have valid permission/);
        });

        test('throws when allowedPurposeOfUse config is empty', () => {
            mockConfigManager.cmsAllowedPurposeOfUse = new Set();
            const requestInfo = makeCmsRequest({ purposeOfUse: ['treatment'] });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have valid permission/);
        });

        test('passes when all conditions met', () => {
            const requestInfo = makeCmsRequest({ method: 'get' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).not.toThrow();
        });
    });

    describe('verifyNotProxyPatientId', () => {
        test('does nothing for non-CMS users', () => {
            expect(() => cmsManager.verifyNotProxyPatientId({
                requestInfo: { userType: 'user' },
                patientId: `${PERSON_PROXY_PREFIX}abc-123`
            })).not.toThrow();
        });

        test('throws for CMS user using proxy patient ID', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.verifyNotProxyPatientId({
                requestInfo,
                patientId: `${PERSON_PROXY_PREFIX}abc-123`
            })).toThrow(/cannot use proxy patient ID/);
        });

        test('throws for CMS user with proxy ID in comma-separated list', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.verifyNotProxyPatientId({
                requestInfo,
                patientId: `regular-id,${PERSON_PROXY_PREFIX}evil-id`
            })).toThrow(/cannot use proxy patient ID/);
        });

        test('passes for CMS user with regular patient ID', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.verifyNotProxyPatientId({
                requestInfo,
                patientId: 'regular-patient-uuid'
            })).not.toThrow();
        });

        test('passes for null/empty patientId', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.verifyNotProxyPatientId({
                requestInfo,
                patientId: null
            })).not.toThrow();
            expect(() => cmsManager.verifyNotProxyPatientId({
                requestInfo,
                patientId: ''
            })).not.toThrow();
        });
    });

    describe('sanitizeEverythingParams', () => {
        test('does nothing for non-CMS users', () => {
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo: { userType: 'user' },
                parsedArgs: { id: 'a,b,c' }
            })).not.toThrow();
        });

        test('throws for CMS user with comma-separated multiple IDs', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo,
                parsedArgs: { id: 'patient-1,patient-2' }
            })).toThrow(/Multiple IDs are not allowed/);
        });

        test('throws for CMS user with array of multiple IDs', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo,
                parsedArgs: { id: ['patient-1', 'patient-2'] }
            })).toThrow(/Multiple IDs are not allowed/);
        });

        test('passes for CMS user with single ID', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo,
                parsedArgs: { id: 'single-patient' }
            })).not.toThrow();
        });

        test('passes for CMS user with single-element array', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo,
                parsedArgs: { id: ['single-patient'] }
            })).not.toThrow();
        });

        test('passes for CMS user with null id', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo,
                parsedArgs: { id: null }
            })).not.toThrow();
        });

        test('passes for CMS user with undefined id', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo,
                parsedArgs: { id: undefined }
            })).not.toThrow();
        });

        test('passes for CMS user with empty array id', () => {
            const requestInfo = { userType: AUTH_USER_TYPES.cmsPartnerUser };
            expect(() => cmsManager.sanitizeEverythingParams({
                requestInfo,
                parsedArgs: { id: [] }
            })).not.toThrow();
        });
    });

    describe('_verifyPurposeOfUse', () => {
        test('throws when one claim code is not in allowed set', () => {
            const requestInfo = {
                userType: AUTH_USER_TYPES.cmsPartnerUser,
                purposeOfUse: ['treatment', 'unknown-code'],
                user: 'cms-user',
                requestId: 'req-1'
            };
            expect(() => cmsManager._verifyPurposeOfUse(requestInfo))
                .toThrow(/does not have valid permission/);
        });

        test('does not throw when all claim codes are in allowed set', () => {
            const requestInfo = {
                userType: AUTH_USER_TYPES.cmsPartnerUser,
                purposeOfUse: ['treatment', 'payment'],
                user: 'cms-user',
                requestId: 'req-1'
            };
            expect(() => cmsManager._verifyPurposeOfUse(requestInfo)).not.toThrow();
        });

        test('throws when purposeOfUse is null', () => {
            const requestInfo = {
                userType: AUTH_USER_TYPES.cmsPartnerUser,
                purposeOfUse: null,
                user: 'cms-user',
                requestId: 'req-1'
            };
            expect(() => cmsManager._verifyPurposeOfUse(requestInfo))
                .toThrow(/does not have valid permission/);
        });

        test('throws when purposeOfUse is undefined', () => {
            const requestInfo = {
                userType: AUTH_USER_TYPES.cmsPartnerUser,
                purposeOfUse: undefined,
                user: 'cms-user',
                requestId: 'req-1'
            };
            expect(() => cmsManager._verifyPurposeOfUse(requestInfo))
                .toThrow(/does not have valid permission/);
        });
    });

    describe('verifyAccess - method edge cases', () => {
        const makeCmsRequest = (overrides = {}) => ({
            userType: AUTH_USER_TYPES.cmsPartnerUser,
            purposeOfUse: ['treatment'],
            method: 'get',
            user: 'cms-user-1',
            requestId: 'req-1',
            ...overrides
        });

        test('allows access when method is undefined (no method check)', () => {
            const requestInfo = makeCmsRequest({ method: undefined });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).not.toThrow();
        });

        test('allows access when method is null (no method check)', () => {
            const requestInfo = makeCmsRequest({ method: null });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).not.toThrow();
        });

        test('throws ForbiddenError for POST method', () => {
            const requestInfo = makeCmsRequest({ method: 'post' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have access to POST method/);
        });

        test('throws ForbiddenError for PUT method', () => {
            const requestInfo = makeCmsRequest({ method: 'put' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).toThrow(/does not have access to PUT method/);
        });

        test('method comparison is case-insensitive (uppercase GET passes)', () => {
            const requestInfo = makeCmsRequest({ method: 'GET' });
            expect(() => cmsManager.verifyAccess({
                requestInfo,
                resourceType: CMS_PARTNER_ACCESS.ALLOWED_RESOURCE_TYPES[0],
                operation: CMS_PARTNER_ACCESS.ALLOWED_OPERATIONS[0]
            })).not.toThrow();
        });
    });
});
