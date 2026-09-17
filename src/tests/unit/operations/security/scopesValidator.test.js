const { describe, test, expect, beforeEach, jest } = require('@jest/globals');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ConfigManager } = require('../../../../utils/configManager');
const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../../../preSaveHandlers/preSaveOptions');
const { DelegatedAccessScopeManager } = require('../../../../operations/security/delegatedAccessScopeManager');
const { ForbiddenError } = require('../../../../utils/httpErrors');
const { ServerError } = require('../../../../middleware/fhir/utils/server.error');
const { RESOURCE_RESTRICTION_TAG, AUTH_USER_TYPES } = require('../../../../constants');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('ScopesValidator', () => {
    let scopesValidator;
    let mockScopesManager;
    let mockFhirLoggingManager;
    let mockConfigManager;
    let mockPatientScopeManager;
    let mockPreSaveManager;
    let mockDelegatedAccessScopeManager;

    beforeEach(() => {
        mockScopesManager = createMockInstance(ScopesManager);
        mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(false);
        mockScopesManager.getPatientScopes = jest.fn().mockReturnValue([]);
        mockScopesManager.getResourceTypeScopes = jest.fn().mockReturnValue(['user/Patient.read']);
        mockScopesManager.hasPatientScope = jest.fn().mockReturnValue(false);
        mockScopesManager.getAccessCodesFromScopes = jest.fn().mockReturnValue(['client']);
        mockScopesManager.isAccessToResourceAllowedBySecurityTags = jest.fn().mockReturnValue(true);

        mockFhirLoggingManager = createMockInstance(FhirLoggingManager);
        mockFhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);

        mockConfigManager = createMockInstance(ConfigManager);
        Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', {
            get: () => false,
            configurable: true
        });

        mockPatientScopeManager = createMockInstance(PatientScopeManager);
        mockPatientScopeManager.canWriteResourceAsync = jest.fn().mockResolvedValue(true);

        mockPreSaveManager = createMockInstance(PreSaveManager);
        mockPreSaveManager.preSaveAsync = jest.fn().mockImplementation(({ resource }) => Promise.resolve(resource));

        mockDelegatedAccessScopeManager = createMockInstance(DelegatedAccessScopeManager);
        mockDelegatedAccessScopeManager.isAccessAllowedAsync = jest.fn().mockResolvedValue(true);

        scopesValidator = new ScopesValidator({
            scopesManager: mockScopesManager,
            fhirLoggingManager: mockFhirLoggingManager,
            configManager: mockConfigManager,
            patientScopeManager: mockPatientScopeManager,
            preSaveManager: mockPreSaveManager,
            delegatedAccessScopeManager: mockDelegatedAccessScopeManager
        });
    });

    describe('ForbiddenError instanceof bug', () => {
        test('BUG: ForbiddenError instances are not instanceof ForbiddenError due to ServerError constructor', () => {
            // ServerError constructor calls Object.setPrototypeOf(this, ServerError.prototype)
            // which breaks the prototype chain for all subclasses (ForbiddenError, etc.)
            const err = new ForbiddenError('test message');
            // This SHOULD be true but is false due to the bug:
            expect(err instanceof ForbiddenError).toBe(false);
            // Instead it shows as ServerError:
            expect(err instanceof ServerError).toBe(true);
            // The statusCode getter is also lost:
            expect(err.statusCode).toBe(403); // This works because it's assigned via Object.assign
        });
    });

    describe('isScopesValidAsync', () => {
        test('should return ForbiddenError when delegated access is enabled and not allowed', async () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', {
                get: () => true,
                configurable: true
            });
            mockDelegatedAccessScopeManager.isAccessAllowedAsync.mockResolvedValue(false);

            const requestInfo = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: 'actor1',
                personIdFromJwtToken: 'person1',
                user: 'testUser',
                scope: 'user/Patient.read access/client.*'
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'read'
            });

            expect(result).toBeInstanceOf(ServerError);
            expect(result.statusCode).toBe(403);
            expect(result.message).toContain('delegated access');
        });

        test('should proceed with scope check when delegated access is allowed', async () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', {
                get: () => true,
                configurable: true
            });
            mockDelegatedAccessScopeManager.isAccessAllowedAsync.mockResolvedValue(true);

            const requestInfo = {
                userType: AUTH_USER_TYPES.delegatedUser,
                actor: 'actor1',
                personIdFromJwtToken: 'person1',
                user: 'testUser',
                scope: 'user/Patient.read access/client.*'
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'read'
            });

            // Should return undefined (success) since user scopes pass and access codes exist
            expect(result).toBeUndefined();
        });

        test('should return ForbiddenError when no scope is present', async () => {
            const requestInfo = {
                user: 'testUser',
                scope: undefined
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'read'
            });

            expect(result).toBeInstanceOf(ServerError);
            expect(result.statusCode).toBe(403);
            expect(result.message).toContain('no scopes');
        });

        test('should return ForbiddenError when scope is empty string', async () => {
            const requestInfo = {
                user: 'testUser',
                scope: ''
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'read'
            });

            expect(result).toBeInstanceOf(ServerError);
            expect(result.statusCode).toBe(403);
            expect(result.message).toContain('no scopes');
        });

        test('should return undefined when patient scopes grant access', async () => {
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(true);
            mockScopesManager.getPatientScopes.mockReturnValue(['patient/Patient.read']);

            const requestInfo = {
                user: 'testUser',
                scope: 'patient/Patient.read'
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'read'
            });

            expect(result).toBeUndefined();
        });

        test('should return ForbiddenError when scope check passes but access codes are empty', async () => {
            mockScopesManager.getAccessCodesFromScopes.mockReturnValue([]);

            const requestInfo = {
                user: 'testUser',
                scope: 'user/Patient.read access/client.*'
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'read'
            });

            // scopeChecker passes but no access codes found => returns ForbiddenError
            expect(result).toBeInstanceOf(ServerError);
            expect(result.statusCode).toBe(403);
        });

        test('BUG: write is blocked with user scopes when patient scope is present', async () => {
            // This tests the logic at line 105-109:
            // if patient scopes are present but access is not through patient scope,
            // only 'read' is allowed with user scopes
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            mockScopesManager.hasPatientScope.mockReturnValue(true);
            mockScopesManager.getResourceTypeScopes.mockReturnValue(['user/Patient.*']);

            const requestInfo = {
                user: 'testUser',
                scope: 'patient/Observation.read user/Patient.*'
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'write'
            });

            // Write should be forbidden when patient scope is present for non-patient resources
            expect(result).toBeInstanceOf(ServerError);
            expect(result.statusCode).toBe(403);
            expect(result.message).toContain('Write not allowed');
        });

        test('should skip delegated access check for non-delegated user type', async () => {
            Object.defineProperty(mockConfigManager, 'enableDelegatedAccessDetection', {
                get: () => true,
                configurable: true
            });

            const requestInfo = {
                userType: 'regularUser',
                user: 'testUser',
                scope: 'user/Patient.read access/client.*'
            };

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo,
                resourceType: 'Patient',
                accessRequested: 'read'
            });

            // Should not call delegated access check
            expect(mockDelegatedAccessScopeManager.isAccessAllowedAsync).not.toHaveBeenCalled();
        });
    });

    describe('isScopesValidAsync - granular per-interaction CRUDS', () => {
        // These scope tokens use v2 grammar (single/combined CRUDS letters), which is gated
        // behind enableSmartV2CrudsScopes (default off, see configManager.js) -- turn it on for
        // this block so the tests below exercise the granular gate itself.
        beforeEach(() => {
            Object.defineProperty(mockConfigManager, 'enableSmartV2CrudsScopes', {
                value: true, configurable: true
            });
        });

        // A token holding only the 'r' letter (instance read) grants searchById (requires 'r')
        // but not a type-level search (requires 's') -- the doc's own worked example.
        test('user/Patient.r passes searchById but fails search', async () => {
            mockScopesManager.getResourceTypeScopes.mockReturnValue(['user/Patient.r']);

            const requestInfo = {user: 'testUser', scope: 'user/Patient.r access/client.*'};

            const passResult = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'read', action: 'searchById'
            });
            expect(passResult).toBeUndefined();

            const failResult = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'read', action: 'search'
            });
            expect(failResult).toBeInstanceOf(ServerError);
            expect(failResult.statusCode).toBe(403);
        });

        // The converse: a token holding only 's' (search-type) grants search/everything/summary
        // but not an instance-level searchById.
        test('user/Patient.s passes search but fails searchById', async () => {
            mockScopesManager.getResourceTypeScopes.mockReturnValue(['user/Patient.s']);

            const requestInfo = {user: 'testUser', scope: 'user/Patient.s access/client.*'};

            const passResult = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'read', action: 'search'
            });
            expect(passResult).toBeUndefined();

            const failResult = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'read', action: 'searchById'
            });
            expect(failResult).toBeInstanceOf(ServerError);
            expect(failResult.statusCode).toBe(403);
        });

        // create/update/patch/remove require their own distinct letter -- a token scoped to only
        // one of them must not satisfy the others, even though today's accessRequested collapses
        // them all to the same coarse 'write' literal.
        test('user/Patient.c passes create but fails update, patch, and remove', async () => {
            mockScopesManager.getResourceTypeScopes.mockReturnValue(['user/Patient.c']);
            const requestInfo = {user: 'testUser', scope: 'user/Patient.c access/client.*'};

            const createResult = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'write', action: 'create'
            });
            expect(createResult).toBeUndefined();

            for (const action of ['update', 'patch', 'remove']) {
                const result = await scopesValidator.isScopesValidAsync({
                    requestInfo, resourceType: 'Patient', accessRequested: 'write', action
                });
                expect(result).toBeInstanceOf(ServerError);
            }
        });

        // An action not in the granular lookup table (e.g. 'graph', whose action name is reused
        // for both a search-type read and a delete-driven write) falls back to accessRequested
        // exactly as before -- v1 read/write scopes still work for it.
        test('an action outside the granular table falls back to accessRequested', async () => {
            mockScopesManager.getResourceTypeScopes.mockReturnValue(['user/Patient.read']);
            const requestInfo = {user: 'testUser', scope: 'user/Patient.read access/client.*'};

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'read', action: 'graph'
            });
            expect(result).toBeUndefined();
        });

        // The patient-scope write restriction must treat a granular read-type interaction ('s',
        // search) as read, not write, even though it isn't the literal string 'read'.
        test('a granular search-type (s) interaction is allowed via user scopes alongside a patient scope', async () => {
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            mockScopesManager.hasPatientScope.mockReturnValue(true);
            mockScopesManager.getResourceTypeScopes.mockReturnValue(['user/Patient.s']);

            const requestInfo = {user: 'testUser', scope: 'patient/Observation.read user/Patient.s'};

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'read', action: 'everything'
            });
            expect(result).toBeUndefined();
        });

        // ...but a granular write-type interaction ('c', create) is still blocked, same as the
        // existing 'write' literal is, when a patient scope is present and access isn't granted
        // through it.
        test('a granular write-type (c) interaction is still blocked alongside a patient scope', async () => {
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            mockScopesManager.hasPatientScope.mockReturnValue(true);
            mockScopesManager.getResourceTypeScopes.mockReturnValue(['user/Patient.c']);

            const requestInfo = {user: 'testUser', scope: 'patient/Observation.read user/Patient.c'};

            const result = await scopesValidator.isScopesValidAsync({
                requestInfo, resourceType: 'Patient', accessRequested: 'write', action: 'create'
            });
            expect(result).toBeInstanceOf(ServerError);
            expect(result.message).toContain('Write not allowed');
        });
    });

    describe('evaluateResourceTypeScopeMatch', () => {
        test('matches a v1 scope for the legacy action literal', () => {
            expect(scopesValidator.evaluateResourceTypeScopeMatch({
                scopes: ['user/Patient.read'], resourceType: 'Patient', accessRequested: 'read'
            }).success).toBe(true);
        });

        test('matches a wildcard resourceType scope', () => {
            expect(scopesValidator.evaluateResourceTypeScopeMatch({
                scopes: ['user/*.read'], resourceType: 'Patient', accessRequested: 'read'
            }).success).toBe(true);
        });

        test('does not match a different resourceType', () => {
            expect(scopesValidator.evaluateResourceTypeScopeMatch({
                scopes: ['user/Observation.read'], resourceType: 'Patient', accessRequested: 'read'
            }).success).toBe(false);
        });

        test('returns a non-null error and success:false for an unrecognized accessRequested', () => {
            const result = scopesValidator.evaluateResourceTypeScopeMatch({
                scopes: ['user/Patient.read'], resourceType: 'Patient', accessRequested: 'bogus'
            });
            expect(result.success).toBe(false);
            expect(result.error).toBeInstanceOf(Error);
        });

        test('returns success:false with a non-null error when no scope matches', () => {
            const result = scopesValidator.evaluateResourceTypeScopeMatch({
                scopes: ['user/Observation.read'], resourceType: 'Patient', accessRequested: 'read'
            });
            expect(result.success).toBe(false);
            expect(result.error).toBeInstanceOf(Error);
        });

        // enableSmartV2CrudsScopes defaults off (mockConfigManager reads the real getter, which
        // falls back to false with no env var set) -- a v2-grammar scope must not match at all,
        // matching this server's original behavior.
        test('a v2 scope does NOT match when enableSmartV2CrudsScopes is disabled (default)', () => {
            const result = scopesValidator.evaluateResourceTypeScopeMatch({
                scopes: ['user/Patient.r'], resourceType: 'Patient', accessRequested: 'r'
            });
            expect(result.success).toBe(false);
        });
    });

    describe('verifyHasValidScopesAsync', () => {
        test('should throw when scopes are invalid', async () => {
            const requestInfo = {
                user: 'testUser',
                scope: undefined
            };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: { getRawArgs: jest.fn().mockReturnValue({}) },
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read',
                accessRequested: 'read'
            })).rejects.toThrow('no scopes');

            expect(mockFhirLoggingManager.logOperationFailureAsync).toHaveBeenCalled();
        });

        test('should not throw when scopes are valid', async () => {
            const requestInfo = {
                user: 'testUser',
                scope: 'user/Patient.read access/client.*'
            };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: { getRawArgs: jest.fn().mockReturnValue({}) },
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read',
                accessRequested: 'read'
            })).resolves.toBeUndefined();
        });

        test('should handle null parsedArgs without crashing', async () => {
            const requestInfo = {
                user: 'testUser',
                scope: undefined
            };

            await expect(scopesValidator.verifyHasValidScopesAsync({
                requestInfo,
                parsedArgs: null,
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read',
                accessRequested: 'read'
            })).rejects.toThrow('no scopes');
        });
    });

    describe('hasValidScopesAsync', () => {
        test('should return true when scopes are valid', async () => {
            const requestInfo = {
                user: 'testUser',
                scope: 'user/Patient.read access/client.*'
            };

            const result = await scopesValidator.hasValidScopesAsync({
                requestInfo,
                parsedArgs: null,
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read',
                accessRequested: 'read'
            });

            expect(result).toBe(true);
        });

        test('should return false when scopes are invalid', async () => {
            const requestInfo = {
                user: 'testUser',
                scope: undefined
            };

            const result = await scopesValidator.hasValidScopesAsync({
                requestInfo,
                parsedArgs: null,
                resourceType: 'Patient',
                startTime: Date.now(),
                action: 'read',
                accessRequested: 'read'
            });

            expect(result).toBe(false);
        });
    });

    describe('isAccessToResourceAllowedByAccessScopes', () => {
        test('should not throw when access is allowed', () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(true);

            expect(() => {
                scopesValidator.isAccessToResourceAllowedByAccessScopes({
                    requestInfo: { user: 'testUser', scope: 'access/client.*' },
                    resource: { resourceType: 'Patient', id: '123' },
                    accessRequested: 'write'
                });
            }).not.toThrow();
        });

        test('should throw when access is not allowed', () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(false);

            expect(() => {
                scopesValidator.isAccessToResourceAllowedByAccessScopes({
                    requestInfo: { user: 'testUser', scope: 'access/client.*' },
                    resource: { resourceType: 'Patient', id: '123' },
                    accessRequested: 'write'
                });
            }).toThrow('has no write access');
        });

        test('should use write as default accessRequested', () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(true);

            scopesValidator.isAccessToResourceAllowedByAccessScopes({
                requestInfo: { user: 'testUser', scope: 'access/client.*' },
                resource: { resourceType: 'Patient', id: '123' }
            });

            expect(mockScopesManager.isAccessToResourceAllowedBySecurityTags).toHaveBeenCalledWith({
                resource: { resourceType: 'Patient', id: '123' },
                user: 'testUser',
                scope: 'access/client.*',
                accessRequested: 'write'
            });
        });
    });

    describe('isAccessToResourceRestrictedForPatientScope', () => {
        test('should throw when user is isUser and resource has restriction tag', () => {
            const resource = {
                resourceType: 'Patient',
                id: '123',
                meta: {
                    security: [
                        {
                            system: RESOURCE_RESTRICTION_TAG.SYSTEM,
                            code: RESOURCE_RESTRICTION_TAG.CODE
                        }
                    ]
                }
            };

            expect(() => {
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo: { isUser: true, user: 'testUser', scope: 'patient/Patient.*' },
                    resource,
                    accessRequested: 'write'
                });
            }).toThrow('has no write access');
        });

        test('should NOT throw when isUser is false even if resource has restriction tag', () => {
            const resource = {
                resourceType: 'Patient',
                id: '123',
                meta: {
                    security: [
                        {
                            system: RESOURCE_RESTRICTION_TAG.SYSTEM,
                            code: RESOURCE_RESTRICTION_TAG.CODE
                        }
                    ]
                }
            };

            expect(() => {
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo: { isUser: false, user: 'testUser', scope: 'access/client.*' },
                    resource,
                    accessRequested: 'write'
                });
            }).not.toThrow();
        });

        test('should NOT throw when resource does not have restriction tag', () => {
            const resource = {
                resourceType: 'Patient',
                id: '123',
                meta: {
                    security: [
                        { system: 'http://other-system', code: 'other-code' }
                    ]
                }
            };

            expect(() => {
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo: { isUser: true, user: 'testUser', scope: 'patient/Patient.*' },
                    resource,
                    accessRequested: 'write'
                });
            }).not.toThrow();
        });

        test('should NOT throw when resource has no meta.security', () => {
            const resource = {
                resourceType: 'Patient',
                id: '123'
            };

            expect(() => {
                scopesValidator.isAccessToResourceRestrictedForPatientScope({
                    requestInfo: { isUser: true, user: 'testUser', scope: 'patient/Patient.*' },
                    resource,
                    accessRequested: 'write'
                });
            }).not.toThrow();
        });
    });

    describe('isAccessToResourceAllowedByPatientScopes', () => {
        test('should throw when patient scope does not allow writing', async () => {
            mockPatientScopeManager.canWriteResourceAsync.mockResolvedValue(false);

            await expect(scopesValidator.isAccessToResourceAllowedByPatientScopes({
                requestInfo: { user: 'testUser', scope: 'patient/Patient.*' },
                resource: { resourceType: 'Patient', id: '123' },
                base_version: '4_0_0'
            })).rejects.toThrow('do not allow writing');
        });

        test('should not throw when patient scope allows writing', async () => {
            mockPatientScopeManager.canWriteResourceAsync.mockResolvedValue(true);

            await expect(scopesValidator.isAccessToResourceAllowedByPatientScopes({
                requestInfo: { user: 'testUser', scope: 'patient/Patient.*' },
                resource: { resourceType: 'Patient', id: '123' },
                base_version: '4_0_0'
            })).resolves.toBeUndefined();
        });
    });

    describe('isAccessToResourceAllowedByAccessAndPatientScopes', () => {
        test('should call preSaveManager before scope checks', async () => {
            const resource = { resourceType: 'Patient', id: '123' };
            const requestInfo = { user: 'testUser', scope: 'access/client.*', isUser: false };

            await scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo,
                resource,
                base_version: '4_0_0',
                accessRequested: 'write'
            });

            expect(mockPreSaveManager.preSaveAsync).toHaveBeenCalled();
        });

        test('should throw when access scope check fails', async () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(false);

            const resource = { resourceType: 'Patient', id: '123' };
            const requestInfo = { user: 'testUser', scope: 'access/client.*', isUser: false };

            await expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo,
                resource,
                base_version: '4_0_0',
                accessRequested: 'write'
            })).rejects.toThrow('has no write access');
        });

        test('should throw when patient scope check fails', async () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(true);
            mockPatientScopeManager.canWriteResourceAsync.mockResolvedValue(false);

            const resource = { resourceType: 'Patient', id: '123' };
            const requestInfo = { user: 'testUser', scope: 'access/client.*', isUser: false };

            await expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo,
                resource,
                base_version: '4_0_0',
                accessRequested: 'write'
            })).rejects.toThrow('do not allow writing');
        });

        test('should throw when resource is restricted for patient scope', async () => {
            mockScopesManager.isAccessToResourceAllowedBySecurityTags.mockReturnValue(true);
            mockPatientScopeManager.canWriteResourceAsync.mockResolvedValue(true);

            const resource = {
                resourceType: 'Patient',
                id: '123',
                meta: {
                    security: [
                        {
                            system: RESOURCE_RESTRICTION_TAG.SYSTEM,
                            code: RESOURCE_RESTRICTION_TAG.CODE
                        }
                    ]
                }
            };
            const requestInfo = { user: 'testUser', scope: 'access/client.*', isUser: true };

            await expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo,
                resource,
                base_version: '4_0_0',
                accessRequested: 'write'
            })).rejects.toThrow('has no write access');
        });
    });

    // DCON-4808: gates _debug/_explain/_setIndexHint in history.js/searchBundle.js/
    // searchStreaming.js
    describe('isAdminScope', () => {
        test('returns true when scope contains an admin/ scope', () => {
            mockScopesManager.getAdminScopes = jest.fn().mockReturnValue(['admin/*.*']);
            expect(scopesValidator.isAdminScope({ scope: 'admin/*.* user/Patient.read' })).toBe(true);
        });

        test('returns false when scope contains no admin/ scope', () => {
            mockScopesManager.getAdminScopes = jest.fn().mockReturnValue([]);
            expect(scopesValidator.isAdminScope({ scope: 'user/Patient.read' })).toBe(false);
        });

        // A narrow admin grant for one specific capability must not unlock a cross-cutting,
        // not-resource-scoped one like _explain/_debug/_setIndexHint.
        test('returns false when the admin scope is resource-specific, not a wildcard', () => {
            mockScopesManager.getAdminScopes = jest.fn().mockReturnValue(['admin/AuditEvent.write']);
            expect(scopesValidator.isAdminScope({ scope: 'admin/AuditEvent.write user/Patient.read' })).toBe(false);
        });

        test('returns true when at least one admin scope is a wildcard, even alongside a resource-specific one', () => {
            mockScopesManager.getAdminScopes = jest.fn().mockReturnValue(['admin/AuditEvent.write', 'admin/*.read']);
            expect(scopesValidator.isAdminScope({ scope: 'admin/AuditEvent.write admin/*.read' })).toBe(true);
        });
    });
});
