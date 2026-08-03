const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { ForbiddenError } = require('../../../../utils/httpErrors');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ScopesManager', () => {
    let scopesManager;
    let mockConfigManager;
    let mockPatientFilterManager;

    beforeEach(() => {
        mockConfigManager = createMockInstance(ConfigManager);
        mockPatientFilterManager = createMockInstance(PatientFilterManager);
        mockPatientFilterManager.canAccessResourceWithPatientScope = jest.fn().mockReturnValue(false);

        scopesManager = new ScopesManager({
            configManager: mockConfigManager,
            patientFilterManager: mockPatientFilterManager
        });
    });

    describe('parseScopes', () => {
        test('should return empty array for null scope', () => {
            expect(scopesManager.parseScopes(null)).toEqual([]);
        });

        test('should return empty array for undefined scope', () => {
            expect(scopesManager.parseScopes(undefined)).toEqual([]);
        });

        test('should return empty array for empty string', () => {
            expect(scopesManager.parseScopes('')).toEqual([]);
        });

        test('should split space-separated scopes', () => {
            const result = scopesManager.parseScopes('user/Patient.read access/client.*');
            expect(result).toEqual(['user/Patient.read', 'access/client.*']);
        });

        test('should handle single scope', () => {
            const result = scopesManager.parseScopes('user/Patient.read');
            expect(result).toEqual(['user/Patient.read']);
        });
    });

    describe('getAccessCodesFromScopes', () => {
        test('should return empty array when scope is null', () => {
            const result = scopesManager.getAccessCodesFromScopes('read', 'testUser', null);
            expect(result).toEqual([]);
        });

        test('should return empty array when no access scopes present', () => {
            const result = scopesManager.getAccessCodesFromScopes('read', 'testUser', 'user/Patient.read');
            expect(result).toEqual([]);
        });

        test('should extract access codes with wildcard action', () => {
            const result = scopesManager.getAccessCodesFromScopes('read', 'testUser', 'access/client.*');
            expect(result).toEqual(['client']);
        });

        test('should extract access codes with matching action', () => {
            const result = scopesManager.getAccessCodesFromScopes('read', 'testUser', 'access/client.read');
            expect(result).toEqual(['client']);
        });

        test('should NOT extract access codes when action does not match', () => {
            const result = scopesManager.getAccessCodesFromScopes('write', 'testUser', 'access/client.read');
            expect(result).toEqual([]);
        });

        test('should extract multiple access codes', () => {
            const result = scopesManager.getAccessCodesFromScopes(
                'read', 'testUser', 'access/client.read access/admin.*'
            );
            expect(result).toEqual(['client', 'admin']);
        });

        test('should throw when user is not a string', () => {
            expect(() => {
                scopesManager.getAccessCodesFromScopes('read', undefined, 'access/client.*');
            }).toThrow();
        });

        test('should throw when user is null', () => {
            expect(() => {
                scopesManager.getAccessCodesFromScopes('read', null, 'access/client.*');
            }).toThrow();
        });
    });

    describe('doesResourceHaveAnyAccessCodeFromThisList', () => {
        test('should return false for null access codes', () => {
            const resource = { meta: { security: [] } };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(null, resource)).toBe(false);
        });

        test('should return false for empty access codes', () => {
            const resource = { meta: { security: [] } };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList([], resource)).toBe(false);
        });

        test('should return true when access codes contains wildcard *', () => {
            const resource = { meta: { security: [] } };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['*'], resource)).toBe(true);
        });

        test('should return false when resource has no meta', () => {
            const resource = {};
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['client'], resource)).toBe(false);
        });

        test('should return false when resource has no security tags', () => {
            const resource = { meta: {} };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['client'], resource)).toBe(false);
        });

        test('should return true when resource has BOTH matching owner and access tags', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client' },
                        { system: SecurityTagSystem.access, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['client'], resource)).toBe(true);
        });

        test('should return false when resource has ONLY owner tag but no access tag', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['client'], resource)).toBe(false);
        });

        test('should return false when resource has ONLY access tag but no owner tag', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['client'], resource)).toBe(false);
        });

        test('should return true when different access codes match owner and access tags', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'ownerA' },
                        { system: SecurityTagSystem.access, code: 'accessB' }
                    ]
                }
            };
            // Both 'ownerA' and 'accessB' are in the access codes list
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['ownerA', 'accessB'], resource)).toBe(true);
        });

        test('should return false when access code matches owner but not access tag', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client' },
                        { system: SecurityTagSystem.access, code: 'other' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveAnyAccessCodeFromThisList(['client'], resource)).toBe(false);
        });
    });

    describe('isAccessToResourceAllowedBySecurityTags', () => {
        test('should return true when patient scopes allow access', () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(true);
            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource: { resourceType: 'Patient' },
                user: 'testUser',
                scope: 'patient/Patient.read access/client.*',
                accessRequested: 'read'
            });
            expect(result).toBe(true);
        });

        test('should throw ForbiddenError when no access codes exist and patient scope is not valid', () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(false);
            expect(() => {
                scopesManager.isAccessToResourceAllowedBySecurityTags({
                    resource: { resourceType: 'Patient' },
                    user: 'testUser',
                    scope: 'user/Patient.read',
                    accessRequested: 'read'
                });
            }).toThrow('has no access scopes');
        });

        test('should check resource security tags when access codes exist', () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(false);
            const resource = {
                resourceType: 'Patient',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client' },
                        { system: SecurityTagSystem.access, code: 'client' }
                    ]
                }
            };
            const result = scopesManager.isAccessToResourceAllowedBySecurityTags({
                resource,
                user: 'testUser',
                scope: 'user/Patient.read access/client.read',
                accessRequested: 'read'
            });
            expect(result).toBe(true);
        });
    });

    describe('doesResourceHaveAccessTags', () => {
        test('should return false for null resource', () => {
            expect(scopesManager.doesResourceHaveAccessTags(null)).toBeFalsy();
        });

        test('should return false for resource without meta', () => {
            expect(scopesManager.doesResourceHaveAccessTags({})).toBeFalsy();
        });

        test('should return false for resource with meta but no security', () => {
            expect(scopesManager.doesResourceHaveAccessTags({ meta: {} })).toBeFalsy();
        });

        test('should return false when no security tags match access system', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveAccessTags(resource)).toBeFalsy();
        });

        test('should return true when access tag is present', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveAccessTags(resource)).toBeTruthy();
        });
    });

    describe('doesResourceHaveOwnerTags', () => {
        test('should return false for null resource', () => {
            expect(scopesManager.doesResourceHaveOwnerTags(null)).toBeFalsy();
        });

        test('should return true when owner tag is present', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveOwnerTags(resource)).toBeTruthy();
        });
    });

    describe('doesResourceHaveMultipleOwnerTags', () => {
        test('should return false when resource has no meta', () => {
            const resource = {};
            expect(scopesManager.doesResourceHaveMultipleOwnerTags(resource)).toBeFalsy();
        });

        test('should return false with single owner tag', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveMultipleOwnerTags(resource)).toBeFalsy();
        });

        test('should return true with multiple owner tags', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'client1' },
                        { system: SecurityTagSystem.owner, code: 'client2' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveMultipleOwnerTags(resource)).toBeTruthy();
        });
    });

    describe('doesResourceHaveInvalidMetaSecurity', () => {
        test('should return false when resource has no meta', () => {
            const resource = {};
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeFalsy();
        });

        test('should return true when system is null string', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'null', code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeTruthy();
        });

        test('should return true when system is NULL (case insensitive)', () => {
            const resource = {
                meta: {
                    security: [
                        { system: 'NULL', code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeTruthy();
        });

        test('should return true when system is empty string', () => {
            const resource = {
                meta: {
                    security: [
                        { system: '', code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeTruthy();
        });

        test('should return true when code is null string', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'null' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeTruthy();
        });

        test('should return false when all tags are valid', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'client' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeFalsy();
        });

        test('BUG: should handle security entry with undefined system without crashing', () => {
            // This tests a potential null reference when system is undefined
            // The code calls s.system?.toLowerCase() which is safe for undefined
            // But s.system === '' would be false for undefined
            const resource = {
                meta: {
                    security: [
                        { code: 'client' }  // no system property
                    ]
                }
            };
            // Should not crash, should return false since undefined !== '' and undefined?.toLowerCase() is undefined
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeFalsy();
        });

        test('BUG: should handle security entry with undefined code without crashing', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access }  // no code property
                    ]
                }
            };
            // Should not crash
            expect(scopesManager.doesResourceHaveInvalidMetaSecurity(resource)).toBeFalsy();
        });
    });

    describe('getAdminScopes', () => {
        test('should return empty array for undefined scope', () => {
            expect(scopesManager.getAdminScopes({ scope: undefined })).toEqual([]);
        });

        test('should return empty array for null scope', () => {
            expect(scopesManager.getAdminScopes({ scope: null })).toEqual([]);
        });

        test('should extract admin scopes', () => {
            expect(scopesManager.getAdminScopes({ scope: 'admin/Patient.read user/Observation.read' }))
                .toEqual(['admin/Patient.read']);
        });
    });

    describe('getPatientScopes', () => {
        test('should return empty array for undefined scope', () => {
            expect(scopesManager.getPatientScopes({ scope: undefined })).toEqual([]);
        });

        test('should extract patient scopes', () => {
            expect(scopesManager.getPatientScopes({ scope: 'patient/Patient.read user/Observation.read' }))
                .toEqual(['patient/Patient.read']);
        });
    });

    describe('getUserScopes', () => {
        test('should return empty array for undefined scope', () => {
            expect(scopesManager.getUserScopes({ scope: undefined })).toEqual([]);
        });

        test('should extract user scopes', () => {
            expect(scopesManager.getUserScopes({ scope: 'patient/Patient.read user/Observation.read' }))
                .toEqual(['user/Observation.read']);
        });
    });

    describe('getScopeFromRequest', () => {
        test('should return undefined when req has no authInfo', () => {
            expect(scopesManager.getScopeFromRequest({ req: {} })).toBeUndefined();
        });

        test('should return scope from authInfo', () => {
            const req = { authInfo: { scope: 'user/Patient.read' } };
            expect(scopesManager.getScopeFromRequest({ req })).toBe('user/Patient.read');
        });

        test('should return undefined when authInfo has no scope', () => {
            const req = { authInfo: {} };
            expect(scopesManager.getScopeFromRequest({ req })).toBeUndefined();
        });
    });

    describe('isAccessAllowedByPatientScopes', () => {
        test('should throw when scope is falsy', () => {
            expect(() => {
                scopesManager.isAccessAllowedByPatientScopes({ scope: '', resourceType: 'Patient' });
            }).toThrow();
        });

        test('should throw when resourceType is falsy', () => {
            expect(() => {
                scopesManager.isAccessAllowedByPatientScopes({ scope: 'patient/Patient.read', resourceType: '' });
            }).toThrow();
        });

        test('should return false when resource cannot be accessed with patient scope', () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(false);
            const result = scopesManager.isAccessAllowedByPatientScopes({
                scope: 'patient/Patient.read',
                resourceType: 'Organization'
            });
            expect(result).toBe(false);
        });

        test('should return true when patient scope is present and resource is patient-accessible', () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(true);
            const result = scopesManager.isAccessAllowedByPatientScopes({
                scope: 'patient/Patient.read',
                resourceType: 'Patient'
            });
            expect(result).toBe(true);
        });

        test('should return false when no patient/ scope is present even if resource is patient-accessible', () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(true);
            const result = scopesManager.isAccessAllowedByPatientScopes({
                scope: 'user/Patient.read',
                resourceType: 'Patient'
            });
            expect(result).toBe(false);
        });
    });

    describe('hasPatientScope', () => {
        test('should throw when scope is falsy', () => {
            expect(() => {
                scopesManager.hasPatientScope({ scope: '' });
            }).toThrow();
        });

        test('should return true when patient/ scope is present', () => {
            expect(scopesManager.hasPatientScope({ scope: 'patient/Patient.read' })).toBe(true);
        });

        test('should return false when no patient/ scope is present', () => {
            expect(scopesManager.hasPatientScope({ scope: 'user/Patient.read' })).toBe(false);
        });
    });

    describe('doesResourceHaveMetaSource', () => {
        test('should return falsy for null resource', () => {
            expect(scopesManager.doesResourceHaveMetaSource(null)).toBeFalsy();
        });

        test('should return falsy for resource without meta', () => {
            expect(scopesManager.doesResourceHaveMetaSource({})).toBeFalsy();
        });

        test('should return falsy for resource with meta but no source', () => {
            expect(scopesManager.doesResourceHaveMetaSource({ meta: {} })).toBeFalsy();
        });

        test('should return truthy when meta.source is present', () => {
            expect(scopesManager.doesResourceHaveMetaSource({ meta: { source: 'http://example.com' } })).toBeTruthy();
        });
    });

    describe('doesResourceHaveSourceAssigningAuthority', () => {
        test('should return falsy for null resource', () => {
            expect(scopesManager.doesResourceHaveSourceAssigningAuthority(null)).toBeFalsy();
        });

        test('should return truthy when sourceAssigningAuthority tag present', () => {
            const resource = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.sourceAssigningAuthority, code: 'bwell' }
                    ]
                }
            };
            expect(scopesManager.doesResourceHaveSourceAssigningAuthority(resource)).toBeTruthy();
        });
    });
});
