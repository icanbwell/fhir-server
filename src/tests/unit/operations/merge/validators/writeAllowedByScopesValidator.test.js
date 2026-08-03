'use strict';

/**
 * Unit tests for WriteAllowedByScopesValidator
 * Focus: scope-based write access control during $merge, security edge cases
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

const { WriteAllowedByScopesValidator } = require('../../../../../operations/merge/validators/writeAllowedByScopesValidator');
const { ScopesValidator } = require('../../../../../operations/security/scopesValidator');
const { DatabaseBulkLoader } = require('../../../../../dataLayer/databaseBulkLoader');

/**
 * Create a mock ScopesValidator that passes instanceof check
 */
function createMockScopesValidator (overrides = {}) {
    const mock = Object.create(ScopesValidator.prototype);
    mock.isAccessToResourceAllowedByAccessAndPatientScopes = jest.fn().mockResolvedValue(undefined);
    Object.assign(mock, overrides);
    return mock;
}

/**
 * Create a mock DatabaseBulkLoader that passes instanceof check
 */
function createMockDatabaseBulkLoader (overrides = {}) {
    const mock = Object.create(DatabaseBulkLoader.prototype);
    mock.getResourceFromExistingList = jest.fn().mockReturnValue(null);
    Object.assign(mock, overrides);
    return mock;
}

/**
 * Helper to create a minimal resource object
 */
function createResource ({ resourceType = 'Patient', id = 'test-1', uuid = 'uuid-1', meta = {} } = {}) {
    return {
        resourceType,
        id,
        _uuid: uuid,
        meta: { sourceAssigningAuthority: 'test-authority', ...meta }
    };
}

/**
 * Helper to create a minimal requestInfo object
 */
function createRequestInfo (overrides = {}) {
    return {
        requestId: 'req-123',
        scope: 'user/*.write',
        ...overrides
    };
}

/**
 * Create a 403 Forbidden error matching what scopesValidator throws
 */
function create403Error (message = 'Access denied') {
    const error = new Error(message);
    error.statusCode = 403;
    error.issue = [
        {
            severity: 'error',
            code: 'forbidden',
            details: { text: message }
        }
    ];
    return error;
}

/**
 * Create a non-403 error (e.g., 500 Internal Server Error)
 */
function createNon403Error (message = 'Internal error', statusCode = 500) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

describe('WriteAllowedByScopesValidator', () => {
    let scopesValidator;
    let databaseBulkLoader;
    let validator;
    let requestInfo;

    beforeEach(() => {
        scopesValidator = createMockScopesValidator();
        databaseBulkLoader = createMockDatabaseBulkLoader();
        validator = new WriteAllowedByScopesValidator({ scopesValidator, databaseBulkLoader });
        requestInfo = createRequestInfo();
    });

    describe('constructor', () => {
        test('throws when scopesValidator is not an instance of ScopesValidator', () => {
            expect(() => new WriteAllowedByScopesValidator({
                scopesValidator: {},
                databaseBulkLoader
            })).toThrow();
        });

        test('throws when databaseBulkLoader is not an instance of DatabaseBulkLoader', () => {
            expect(() => new WriteAllowedByScopesValidator({
                scopesValidator,
                databaseBulkLoader: {}
            })).toThrow();
        });

        test('throws when scopesValidator is null', () => {
            expect(() => new WriteAllowedByScopesValidator({
                scopesValidator: null,
                databaseBulkLoader
            })).toThrow();
        });

        test('throws when databaseBulkLoader is null', () => {
            expect(() => new WriteAllowedByScopesValidator({
                scopesValidator,
                databaseBulkLoader: null
            })).toThrow();
        });

        test('succeeds with valid mock instances', () => {
            expect(validator).toBeInstanceOf(WriteAllowedByScopesValidator);
        });
    });

    describe('happy path: all resources pass validation', () => {
        test('returns all resources in validatedObjects when scopes allow access', async () => {
            const resources = [
                createResource({ id: 'p1', uuid: 'uuid-1' }),
                createResource({ id: 'p2', uuid: 'uuid-2' })
            ];

            const result = await validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(2);
            expect(result.validatedObjects[0].id).toBe('p1');
            expect(result.validatedObjects[1].id).toBe('p2');
            expect(result.preCheckErrors).toEqual([]);
            expect(result.wasAList).toBe(false);
        });

        test('validates against incoming resource when no existing resource found', async () => {
            const resource = createResource({ id: 'new-1', uuid: 'uuid-new' });
            databaseBulkLoader.getResourceFromExistingList.mockReturnValue(null);

            await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes).toHaveBeenCalledWith({
                resource,
                requestInfo,
                base_version: '4_0_0'
            });
        });

        test('validates against existing resource when found in database', async () => {
            const incomingResource = createResource({ id: 'existing-1', uuid: 'uuid-existing' });
            const existingResource = createResource({
                id: 'existing-1',
                uuid: 'uuid-existing',
                meta: { sourceAssigningAuthority: 'db-authority' }
            });

            databaseBulkLoader.getResourceFromExistingList.mockReturnValue(existingResource);

            await validator.validate({
                requestInfo,
                incomingResources: [incomingResource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // Should validate against the EXISTING resource, not incoming
            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes).toHaveBeenCalledWith({
                resource: existingResource,
                requestInfo,
                base_version: '4_0_0'
            });
        });

        test('calls databaseBulkLoader with correct parameters', async () => {
            const resource = createResource({
                resourceType: 'Observation',
                id: 'obs-1',
                uuid: 'uuid-obs'
            });

            await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(databaseBulkLoader.getResourceFromExistingList).toHaveBeenCalledWith({
                requestId: 'req-123',
                resourceType: 'Observation',
                uuid: 'uuid-obs'
            });
        });
    });

    describe('403 error handling: resources excluded silently', () => {
        test('captures 403 error in preCheckErrors and excludes resource from validatedObjects', async () => {
            const resource = createResource({ id: 'denied-1', uuid: 'uuid-denied' });
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(create403Error('Insufficient scopes'));

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(0);
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.preCheckErrors[0].id).toBe('denied-1');
            expect(result.preCheckErrors[0].resourceType).toBe('Patient');
            expect(result.preCheckErrors[0].created).toBe(false);
            expect(result.preCheckErrors[0].updated).toBe(false);
        });

        test('preCheckError contains operationOutcome with issue from the 403 error', async () => {
            const error403 = create403Error('Patient scope does not allow write');
            const resource = createResource({ id: 'denied-2', uuid: 'uuid-denied-2' });
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(error403);

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            const preCheckError = result.preCheckErrors[0];
            expect(preCheckError.operationOutcome).toBeDefined();
            expect(preCheckError.operationOutcome.resourceType).toBe('OperationOutcome');
        });

        test('preCheckError includes sourceAssigningAuthority from resource meta', async () => {
            const resource = createResource({
                id: 'denied-3',
                uuid: 'uuid-denied-3',
                meta: { sourceAssigningAuthority: 'my-authority' }
            });
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(create403Error());

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.preCheckErrors[0]._sourceAssigningAuthority).toBe('my-authority');
        });

        test('SECURITY: 403 is captured silently — $merge returns 200 OK with partial results', async () => {
            // SECURITY BUG: When a resource is rejected due to 403, it is silently
            // excluded from validatedObjects. The overall $merge operation continues
            // and returns 200 OK. A caller may not realize their resource write was
            // rejected unless they inspect the preCheckErrors in the response body.
            const allowedResource = createResource({ id: 'allowed-1', uuid: 'uuid-allowed' });
            const deniedResource = createResource({ id: 'denied-1', uuid: 'uuid-denied' });

            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockImplementation(async ({ resource }) => {
                    if (resource.id === 'denied-1') {
                        throw create403Error('Access denied');
                    }
                });

            const result = await validator.validate({
                requestInfo,
                incomingResources: [allowedResource, deniedResource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // The operation "succeeds" — allowed resource passes through
            expect(result.validatedObjects).toHaveLength(1);
            expect(result.validatedObjects[0].id).toBe('allowed-1');

            // Denied resource is only in preCheckErrors — easy to miss
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.preCheckErrors[0].id).toBe('denied-1');
        });

        test('multiple resources can each independently fail with 403', async () => {
            const resources = [
                createResource({ id: 'r1', uuid: 'u1' }),
                createResource({ id: 'r2', uuid: 'u2' }),
                createResource({ id: 'r3', uuid: 'u3' })
            ];

            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockImplementation(async ({ resource }) => {
                    if (resource.id === 'r1' || resource.id === 'r3') {
                        throw create403Error(`Denied: ${resource.id}`);
                    }
                });

            const result = await validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(1);
            expect(result.validatedObjects[0].id).toBe('r2');
            expect(result.preCheckErrors).toHaveLength(2);
            expect(result.preCheckErrors[0].id).toBe('r1');
            expect(result.preCheckErrors[1].id).toBe('r3');
        });

        test('all resources failing with 403 returns empty validatedObjects', async () => {
            const resources = [
                createResource({ id: 'r1', uuid: 'u1' }),
                createResource({ id: 'r2', uuid: 'u2' })
            ];

            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(create403Error('All denied'));

            const result = await validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(0);
            expect(result.preCheckErrors).toHaveLength(2);
        });
    });

    describe('non-403 error handling: errors rethrown', () => {
        test('rethrows 500 Internal Server Error', async () => {
            const resource = createResource({ id: 'r1', uuid: 'u1' });
            const error500 = createNon403Error('Database connection failed', 500);
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(error500);

            await expect(validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            })).rejects.toThrow('Database connection failed');
        });

        test('rethrows 401 Unauthorized error', async () => {
            const resource = createResource({ id: 'r1', uuid: 'u1' });
            const error401 = createNon403Error('Token expired', 401);
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(error401);

            await expect(validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            })).rejects.toThrow('Token expired');
        });

        test('rethrows error without statusCode property', async () => {
            const resource = createResource({ id: 'r1', uuid: 'u1' });
            const genericError = new Error('Something went wrong');
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(genericError);

            await expect(validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            })).rejects.toThrow('Something went wrong');
        });

        test('rethrows TypeError from internal bug', async () => {
            const resource = createResource({ id: 'r1', uuid: 'u1' });
            const typeError = new TypeError('Cannot read properties of null');
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(typeError);

            await expect(validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            })).rejects.toThrow(TypeError);
        });

        test('non-403 error stops processing remaining resources', async () => {
            const resources = [
                createResource({ id: 'r1', uuid: 'u1' }),
                createResource({ id: 'r2', uuid: 'u2' }),
                createResource({ id: 'r3', uuid: 'u3' })
            ];

            let callCount = 0;
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockImplementation(async () => {
                    callCount++;
                    if (callCount === 2) {
                        throw createNon403Error('Server error', 500);
                    }
                });

            await expect(validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            })).rejects.toThrow('Server error');

            // r3 should never be reached because r2 threw a non-403 error
            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .toHaveBeenCalledTimes(2);
        });
    });

    describe('empty and edge case inputs', () => {
        test('empty incomingResources array returns empty validatedObjects and preCheckErrors', async () => {
            const result = await validator.validate({
                requestInfo,
                incomingResources: [],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toEqual([]);
            expect(result.preCheckErrors).toEqual([]);
            expect(result.wasAList).toBe(false);
        });

        test('scopesValidator is never called for empty incomingResources', async () => {
            await validator.validate({
                requestInfo,
                incomingResources: [],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .not.toHaveBeenCalled();
        });

        test('databaseBulkLoader is never called for empty incomingResources', async () => {
            await validator.validate({
                requestInfo,
                incomingResources: [],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(databaseBulkLoader.getResourceFromExistingList).not.toHaveBeenCalled();
        });

        test('single resource in array is processed correctly', async () => {
            const resource = createResource({ id: 'solo', uuid: 'uuid-solo' });

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(1);
            expect(result.validatedObjects[0].id).toBe('solo');
        });
    });

    describe('SECURITY: validates only existing OR incoming, not BOTH', () => {
        test('BUG: when existing resource found, incoming resource is NOT validated', async () => {
            // SECURITY BUG: The code checks access against the EXISTING resource when one
            // is found, but does NOT also check the INCOMING resource. An attacker who
            // owns a resource can modify it to include security tags that grant access to
            // other tenants. The existing check passes (they own it), but the NEW security
            // tags are never validated.
            const incomingResource = createResource({
                id: 'patient-1',
                uuid: 'uuid-patient-1',
                meta: {
                    sourceAssigningAuthority: 'attacker-authority',
                    security: [{ system: 'http://security', code: 'OTHER_TENANT' }]
                }
            });

            const existingResource = createResource({
                id: 'patient-1',
                uuid: 'uuid-patient-1',
                meta: {
                    sourceAssigningAuthority: 'legit-authority',
                    security: [{ system: 'http://security', code: 'MY_TENANT' }]
                }
            });

            databaseBulkLoader.getResourceFromExistingList.mockReturnValue(existingResource);

            const result = await validator.validate({
                requestInfo,
                incomingResources: [incomingResource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // BUG: Validation passes because it only checks existing (which user owns).
            // The incoming resource with OTHER_TENANT security tags is never validated.
            expect(result.validatedObjects).toHaveLength(1);
            expect(result.validatedObjects[0].meta.security[0].code).toBe('OTHER_TENANT');

            // scopesValidator was called with existing resource, not incoming
            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .toHaveBeenCalledWith(expect.objectContaining({
                    resource: existingResource
                }));

            // The incoming resource was NEVER passed to scopesValidator
            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .not.toHaveBeenCalledWith(expect.objectContaining({
                    resource: incomingResource
                }));
        });

        test('BUG: when no existing resource, only incoming is validated (existing never checked)', async () => {
            // If there is no existing resource (new resource), only the incoming is checked.
            // This is correct for new resources but is the other half of the single-check bug:
            // The system never validates BOTH directions.
            const incomingResource = createResource({
                id: 'new-resource',
                uuid: 'uuid-new'
            });

            databaseBulkLoader.getResourceFromExistingList.mockReturnValue(null);

            await validator.validate({
                requestInfo,
                incomingResources: [incomingResource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .toHaveBeenCalledTimes(1);
            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .toHaveBeenCalledWith({
                    resource: incomingResource,
                    requestInfo,
                    base_version: '4_0_0'
                });
        });
    });

    describe('mixed scenarios: some resources pass, some fail', () => {
        test('processes resources in order and builds correct result arrays', async () => {
            const resources = [
                createResource({ id: 'pass-1', uuid: 'u1', resourceType: 'Patient' }),
                createResource({ id: 'fail-1', uuid: 'u2', resourceType: 'Observation' }),
                createResource({ id: 'pass-2', uuid: 'u3', resourceType: 'Condition' }),
                createResource({ id: 'fail-2', uuid: 'u4', resourceType: 'Procedure' })
            ];

            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockImplementation(async ({ resource }) => {
                    if (resource.id.startsWith('fail')) {
                        throw create403Error(`Denied: ${resource.id}`);
                    }
                });

            const result = await validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(2);
            expect(result.validatedObjects[0].id).toBe('pass-1');
            expect(result.validatedObjects[1].id).toBe('pass-2');

            expect(result.preCheckErrors).toHaveLength(2);
            expect(result.preCheckErrors[0].id).toBe('fail-1');
            expect(result.preCheckErrors[0].resourceType).toBe('Observation');
            expect(result.preCheckErrors[1].id).toBe('fail-2');
            expect(result.preCheckErrors[1].resourceType).toBe('Procedure');
        });

        test('existing resource found for some, not others — each checked appropriately', async () => {
            const resource1 = createResource({ id: 'r1', uuid: 'u1' });
            const resource2 = createResource({ id: 'r2', uuid: 'u2' });
            const existingForR1 = createResource({ id: 'r1', uuid: 'u1', meta: { versionId: '2' } });

            databaseBulkLoader.getResourceFromExistingList.mockImplementation(({ uuid }) => {
                if (uuid === 'u1') return existingForR1;
                return null;
            });

            await validator.validate({
                requestInfo,
                incomingResources: [resource1, resource2],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            const calls = scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes.mock.calls;
            // r1: validated against existing resource
            expect(calls[0][0].resource).toBe(existingForR1);
            // r2: validated against incoming resource (no existing found)
            expect(calls[1][0].resource).toBe(resource2);
        });
    });

    describe('wasAList return value', () => {
        test('wasAList is always false regardless of input', async () => {
            const resources = [
                createResource({ id: 'r1', uuid: 'u1' }),
                createResource({ id: 'r2', uuid: 'u2' }),
                createResource({ id: 'r3', uuid: 'u3' })
            ];

            const result = await validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // wasAList is hardcoded to false in this validator
            expect(result.wasAList).toBe(false);
        });

        test('wasAList is false even for single resource', async () => {
            const result = await validator.validate({
                requestInfo,
                incomingResources: [createResource()],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.wasAList).toBe(false);
        });
    });

    describe('preCheckError structure', () => {
        test('preCheckError has correct shape for 403 with issue array', async () => {
            const resource = createResource({
                id: 'test-id',
                uuid: 'test-uuid',
                resourceType: 'Observation',
                meta: { sourceAssigningAuthority: 'test-auth' }
            });

            const error = create403Error('Scope mismatch');
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(error);

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            const entry = result.preCheckErrors[0];
            expect(entry.id).toBe('test-id');
            expect(entry._uuid).toBe('test-uuid');
            expect(entry.resourceType).toBe('Observation');
            expect(entry.created).toBe(false);
            expect(entry.updated).toBe(false);
            expect(entry._sourceAssigningAuthority).toBe('test-auth');
            expect(entry.operationOutcome).toBeDefined();
            expect(entry.issue).toBeDefined();
        });

        test('preCheckError issue is first element from operationOutcome.issue', async () => {
            const error = create403Error('First issue');
            error.issue = [
                { severity: 'error', code: 'forbidden', details: { text: 'First issue' } },
                { severity: 'warning', code: 'informational', details: { text: 'Second issue' } }
            ];
            const resource = createResource();
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(error);

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // Only the first issue is extracted
            const entry = result.preCheckErrors[0];
            expect(entry.issue).toBeDefined();
        });

        test('preCheckError issue is null when 403 error has empty issue array', async () => {
            const error = create403Error('No issues');
            error.issue = [];
            const resource = createResource();
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(error);

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // issue array is empty, so first element is undefined, but code checks length > 0
            expect(result.preCheckErrors[0].issue).toBeNull();
        });

        test('preCheckError issue is null when 403 error has no issue property', async () => {
            const error = new Error('Forbidden');
            error.statusCode = 403;
            // no error.issue property
            const resource = createResource();
            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(error);

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // OperationOutcome is constructed with issue: undefined
            // operationOutcome.issue will be undefined/null, so the ternary returns null
            expect(result.preCheckErrors[0].issue).toBeNull();
        });
    });

    describe('resource with missing meta', () => {
        test('handles resource with no meta property gracefully', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'no-meta',
                _uuid: 'uuid-no-meta'
                // no meta property
            };

            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(create403Error('Denied'));

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // sourceAssigningAuthority should be undefined when meta is missing
            expect(result.preCheckErrors[0]._sourceAssigningAuthority).toBeUndefined();
        });

        test('handles resource with meta but no sourceAssigningAuthority', async () => {
            const resource = {
                resourceType: 'Patient',
                id: 'partial-meta',
                _uuid: 'uuid-partial',
                meta: { versionId: '1' }
            };

            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(create403Error('Denied'));

            const result = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.preCheckErrors[0]._sourceAssigningAuthority).toBeUndefined();
        });
    });

    describe('base_version propagation', () => {
        test('passes base_version to scopesValidator for each resource', async () => {
            const resources = [
                createResource({ id: 'r1', uuid: 'u1' }),
                createResource({ id: 'r2', uuid: 'u2' })
            ];

            await validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            const calls = scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes.mock.calls;
            expect(calls[0][0].base_version).toBe('4_0_0');
            expect(calls[1][0].base_version).toBe('4_0_0');
        });

        test('passes different base_version correctly', async () => {
            const resource = createResource();

            await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '3_0_1',
                effectiveSmartMerge: false
            });

            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .toHaveBeenCalledWith(expect.objectContaining({
                    base_version: '3_0_1'
                }));
        });
    });

    describe('requestInfo propagation', () => {
        test('passes requestInfo to scopesValidator', async () => {
            const customRequestInfo = createRequestInfo({
                requestId: 'custom-req-id',
                scope: 'patient/Patient.write',
                user: 'user-123'
            });
            const resource = createResource();

            await validator.validate({
                requestInfo: customRequestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .toHaveBeenCalledWith(expect.objectContaining({
                    requestInfo: customRequestInfo
                }));
        });

        test('passes requestInfo.requestId to databaseBulkLoader', async () => {
            const customRequestInfo = createRequestInfo({ requestId: 'unique-req-456' });
            const resource = createResource({ resourceType: 'Condition', uuid: 'u-cond' });

            await validator.validate({
                requestInfo: customRequestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(databaseBulkLoader.getResourceFromExistingList).toHaveBeenCalledWith({
                requestId: 'unique-req-456',
                resourceType: 'Condition',
                uuid: 'u-cond'
            });
        });
    });

    describe('SECURITY: patient-scoped token with RESOURCE_RESTRICTION_TAG', () => {
        test('resource with restriction tag is rejected when patient scope active', async () => {
            // If the scopesValidator correctly rejects resources with restriction tags
            // for patient-scoped tokens, this validator should capture the 403.
            const restrictedResource = createResource({
                id: 'restricted-1',
                uuid: 'uuid-restricted',
                meta: {
                    security: [{ system: 'http://security', code: 'RESOURCE_RESTRICTION' }]
                }
            });

            scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes
                .mockRejectedValue(create403Error('Resource restricted for patient scope'));

            const result = await validator.validate({
                requestInfo: createRequestInfo({ scope: 'patient/Patient.write' }),
                incomingResources: [restrictedResource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(0);
            expect(result.preCheckErrors).toHaveLength(1);
            expect(result.preCheckErrors[0].id).toBe('restricted-1');
        });
    });

    describe('effectiveSmartMerge parameter', () => {
        test('effectiveSmartMerge is accepted but not used by this validator', async () => {
            // The effectiveSmartMerge parameter is part of the BaseValidator interface
            // but is not used by WriteAllowedByScopesValidator — it delegates to scopesValidator
            const resource = createResource();

            const resultWithTrue = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: true
            });

            const resultWithFalse = await validator.validate({
                requestInfo,
                incomingResources: [resource],
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            // Both should produce same result
            expect(resultWithTrue.validatedObjects).toHaveLength(1);
            expect(resultWithFalse.validatedObjects).toHaveLength(1);
        });
    });

    describe('large number of resources', () => {
        test('handles many resources efficiently', async () => {
            const resources = Array.from({ length: 100 }, (_, i) =>
                createResource({ id: `r${i}`, uuid: `u${i}` })
            );

            const result = await validator.validate({
                requestInfo,
                incomingResources: resources,
                base_version: '4_0_0',
                effectiveSmartMerge: false
            });

            expect(result.validatedObjects).toHaveLength(100);
            expect(result.preCheckErrors).toHaveLength(0);
            expect(scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes)
                .toHaveBeenCalledTimes(100);
            expect(databaseBulkLoader.getResourceFromExistingList)
                .toHaveBeenCalledTimes(100);
        });
    });
});
