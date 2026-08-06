'use strict';

/**
 * Unit tests for ResourceValidator
 *
 * Top 3 largest methods:
 * 1. upsertProfileInRemoteServer (lines 461-588)
 * 2. validateResourceAsync (lines 185-255)
 * 3. validateResourceFromServerAsync (lines 377-451)
 */

const { describe, beforeEach, afterEach, it, expect, jest } = require('@jest/globals');

const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { ConfigManager } = require('../../../../utils/configManager');
const { RemoteFhirValidator } = require('../../../../utils/remoteFhirValidator');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../../../dataLayer/databaseUpdateFactory');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');

jest.mock('../../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
}));

// Note: validator.util mock does not work reliably with injectGlobals:false,
// so validateResourceAsync tests supply valid FHIR resources instead.

jest.mock('../../../../utils/metrics', () => ({
    recordValidationFailure: jest.fn(),
    VALIDATION_STAGE: { SCHEMA: 'schema', REFERENCE: 'reference', META: 'meta' },
    PATH: { SAVE: 'save', VALIDATE: 'validate' }
}));

jest.mock('../../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn(),
    logSystemEventAsync: jest.fn()
}));

describe('ResourceValidator', () => {
    let resourceValidator;
    let mockConfigManager;
    let mockRemoteFhirValidator;
    let mockDatabaseQueryFactory;
    let mockDatabaseUpdateFactory;
    let mockScopesManager;
    let mockPatientFilterManager;

    beforeEach(() => {
        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'requireMetaSourceTags', { value: true, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'fhirValidationUrl', { value: null, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'batchSizeForRemoteFhir', { value: 5, writable: true, configurable: true });
        Object.defineProperty(mockConfigManager, 'auditEventMaxSizeBytes', { value: 1048576, writable: true, configurable: true });
        mockRemoteFhirValidator = Object.create(RemoteFhirValidator.prototype);
        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseUpdateFactory = Object.create(DatabaseUpdateFactory.prototype);
        mockScopesManager = Object.create(ScopesManager.prototype);
        mockPatientFilterManager = Object.create(PatientFilterManager.prototype);

        resourceValidator = new ResourceValidator({
            configManager: mockConfigManager,
            remoteFhirValidator: mockRemoteFhirValidator,
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseUpdateFactory: mockDatabaseUpdateFactory,
            scopesManager: mockScopesManager,
            patientFilterManager: mockPatientFilterManager
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('validateResourceMetaSync', () => {
        it('returns error when meta is missing and requireMetaSourceTags is true', () => {
            const resource = { resourceType: 'Observation', id: 'obs-1' };

            const result = resourceValidator.validateResourceMetaSync(resource);

            expect(result).not.toBeNull();
            expect(result.issue[0].details.text).toContain('Missing either metadata or metadata source');
        });

        it('returns error when meta.source is missing', () => {
            const resource = { resourceType: 'Observation', id: 'obs-1', meta: {} };

            const result = resourceValidator.validateResourceMetaSync(resource);

            expect(result).not.toBeNull();
            expect(result.issue[0].details.text).toContain('Missing either metadata or metadata source');
        });

        it('returns null when requireMetaSourceTags is false', () => {
            mockConfigManager.requireMetaSourceTags = false;
            mockScopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(true);
            mockScopesManager.doesResourceHaveMultipleOwnerTags = jest.fn().mockReturnValue(false);
            mockScopesManager.doesResourceHaveInvalidMetaSecurity = jest.fn().mockReturnValue(false);

            const resource = { resourceType: 'Observation', id: 'obs-1' };
            const result = resourceValidator.validateResourceMetaSync(resource);
            expect(result).toBeNull();
        });

        it('returns error when owner tags are missing', () => {
            const resource = {
                resourceType: 'Observation', id: 'obs-1',
                meta: { source: 'http://source.com', security: [] }
            };
            mockScopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(false);

            const result = resourceValidator.validateResourceMetaSync(resource);

            expect(result).not.toBeNull();
            expect(result.issue[0].details.text).toContain('missing a security access tag');
        });

        it('returns error when multiple owner tags exist', () => {
            const resource = {
                resourceType: 'Observation', id: 'obs-1',
                meta: { source: 'http://source.com', security: [] }
            };
            mockScopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(true);
            mockScopesManager.doesResourceHaveMultipleOwnerTags = jest.fn().mockReturnValue(true);

            const result = resourceValidator.validateResourceMetaSync(resource);

            expect(result).not.toBeNull();
            expect(result.issue[0].details.text).toContain('multiple security access tag');
        });

        it('returns error when invalid meta.security (null system or code)', () => {
            const resource = {
                resourceType: 'Observation', id: 'obs-1',
                meta: { source: 'http://source.com', security: [{ system: null, code: 'test' }] }
            };
            mockScopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(true);
            mockScopesManager.doesResourceHaveMultipleOwnerTags = jest.fn().mockReturnValue(false);
            mockScopesManager.doesResourceHaveInvalidMetaSecurity = jest.fn().mockReturnValue(true);

            const result = resourceValidator.validateResourceMetaSync(resource);

            expect(result).not.toBeNull();
            expect(result.issue[0].details.text).toContain("null/empty value for 'system' or 'code'");
        });

        it('returns null when all validations pass', () => {
            const resource = {
                resourceType: 'Observation', id: 'obs-1',
                meta: { source: 'http://source.com', security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }] }
            };
            mockScopesManager.doesResourceHaveOwnerTags = jest.fn().mockReturnValue(true);
            mockScopesManager.doesResourceHaveMultipleOwnerTags = jest.fn().mockReturnValue(false);
            mockScopesManager.doesResourceHaveInvalidMetaSecurity = jest.fn().mockReturnValue(false);

            const result = resourceValidator.validateResourceMetaSync(resource);
            expect(result).toBeNull();
        });
    });

    describe('validatePatientReference', () => {
        it('returns null for Patient resource type', async () => {
            const currentResource = { resourceType: 'Patient', id: 'p1' };
            const result = await resourceValidator.validatePatientReference({
                currentResource, resourceToValidateJson: { resourceType: 'Patient', id: 'p2' }, isUser: true
            });
            expect(result).toBeNull();
        });

        it('returns null when no patient field exists for resource type', async () => {
            mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue(null);
            mockPatientFilterManager.getPatientPropertyForPersonScopedResource = jest.fn().mockReturnValue(null);

            const currentResource = { resourceType: 'Organization', id: 'org-1' };
            const result = await resourceValidator.validatePatientReference({
                currentResource, resourceToValidateJson: { resourceType: 'Organization', id: 'org-1' }, isUser: true
            });
            expect(result).toBeNull();
        });

        it('returns OperationOutcome when patient reference changes', async () => {
            mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');
            const currentResource = { resourceType: 'Observation', id: 'obs-1', subject: { reference: 'Patient/p1' } };
            const resourceToValidateJson = { resourceType: 'Observation', id: 'obs-1', subject: { reference: 'Patient/p2' } };

            const result = await resourceValidator.validatePatientReference({
                currentResource, resourceToValidateJson, isUser: true
            });

            expect(result).not.toBeNull();
            const issue = Array.isArray(result.issue) ? result.issue[0] : result.issue;
            expect(issue.details.text).toContain('did not match');
        });

        it('returns null when patient reference matches', async () => {
            mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');
            const currentResource = { resourceType: 'Observation', id: 'obs-1', subject: { reference: 'Patient/p1' } };
            const resourceToValidateJson = { resourceType: 'Observation', id: 'obs-1', subject: { reference: 'Patient/p1' } };

            const result = await resourceValidator.validatePatientReference({
                currentResource, resourceToValidateJson, isUser: true
            });

            expect(result).toBeNull();
        });

        // This asserts today's permissive behavior for the `!isUser` early return
        // (resourceValidator.js ~line 123), which is also what allows the still-open,
        // quarantined Person.link cross-tenant forgery gap documented in
        // src/tests/unit/operations/merge/merge.crossTenant.test.js ("MUST validate that
        // link target Person belongs to same tenant before creating link", DCON-4844) --
        // see review.md section B (Person/Patient link traversal & expansion). If that gap
        // is fixed by adding a target-tenant check for Person.link specifically (tracked in
        // PR #2436), this test (which only exercises a generic `Appointment` reference
        // array, not `Person.link`) should still pass unchanged -- but do not "fix" the
        // vulnerability by loosening this assertion instead of tightening the validator for
        // Person resources.
        it('allows array reference update for non-user scope on a non-Person resource', async () => {
            mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('participant.actor.reference');
            const currentResource = { resourceType: 'Appointment', id: 'app-1', participant: [{ actor: { reference: 'Patient/p1' } }] };
            const resourceToValidateJson = { resourceType: 'Appointment', id: 'app-1', participant: [{ actor: { reference: 'Patient/p1' } }, { actor: { reference: 'Patient/p2' } }] };

            const result = await resourceValidator.validatePatientReference({
                currentResource, resourceToValidateJson, isUser: false
            });

            // DCON-4844's cross-tenant check is scoped to Person.link -- this is a tripwire: if the
            // gap for other array reference fields (see review.md section B) is ever fixed by
            // tightening this validator generically instead of Person-specifically, this test
            // should keep passing unchanged, since it doesn't touch Person at all.
            expect(result).toBeNull();
        });
    });

    describe('validatePatientReference — Person.link cross-tenant check (DCON-4844)', () => {
        /**
         * @type {ScopesManager}
         */
        let realScopesManager;
        /**
         * @type {ResourceValidator}
         */
        let personResourceValidator;
        let mockFindAsync;

        /**
         * @param {Object[]} resources
         */
        function resolveTargetsAs (resources) {
            mockFindAsync.mockResolvedValue({
                toObjectArrayAsync: jest.fn().mockResolvedValue(resources)
            });
        }

        beforeEach(() => {
            realScopesManager = new ScopesManager({
                configManager: mockConfigManager,
                patientFilterManager: new PatientFilterManager()
            });
            mockFindAsync = jest.fn();
            resolveTargetsAs([]);
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({
                findAsync: mockFindAsync
            });
            mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue(null);
            mockPatientFilterManager.getPatientPropertyForPersonScopedResource = jest.fn().mockReturnValue('link.target.reference');

            personResourceValidator = new ResourceValidator({
                configManager: mockConfigManager,
                remoteFhirValidator: mockRemoteFhirValidator,
                databaseQueryFactory: mockDatabaseQueryFactory,
                databaseUpdateFactory: mockDatabaseUpdateFactory,
                scopesManager: realScopesManager,
                patientFilterManager: mockPatientFilterManager
            });
        });

        function personWithLinks (uuids) {
            return {
                resourceType: 'Person',
                id: 'person-1',
                link: uuids.map(uuid => ({ target: { reference: `Person/${uuid}` } }))
            };
        }

        it('rejects a non-user caller linking to a Person owned by another tenant', async () => {
            resolveTargetsAs([{
                resourceType: 'Person',
                id: 'other-tenant-person',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                        { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
                    ]
                }
            }]);

            const result = await personResourceValidator.validatePatientReference({
                currentResource: personWithLinks(['uuid-a']),
                resourceToValidateJson: personWithLinks(['uuid-a', 'uuid-tenant-b-person']),
                isUser: false,
                user: 'service@tenant_a',
                scope: 'access/tenant_a.*',
                base_version: '4_0_0'
            });

            expect(result).not.toBeNull();
            const issue = Array.isArray(result.issue) ? result.issue[0] : result.issue;
            expect(issue.details.text).toContain('does not have access');
        });

        it('allows a non-user caller linking to a Person owned by their own tenant', async () => {
            resolveTargetsAs([{
                resourceType: 'Person',
                id: 'same-tenant-person',
                meta: {
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'tenant_a' },
                        { system: 'https://www.icanbwell.com/access', code: 'tenant_a' }
                    ]
                }
            }]);

            const result = await personResourceValidator.validatePatientReference({
                currentResource: personWithLinks(['uuid-a']),
                resourceToValidateJson: personWithLinks(['uuid-a', 'uuid-same-tenant-person']),
                isUser: false,
                user: 'service@tenant_a',
                scope: 'access/tenant_a.*',
                base_version: '4_0_0'
            });

            expect(result).toBeNull();
        });

        it('allows a full-access (*) caller to link across tenants', async () => {
            const result = await personResourceValidator.validatePatientReference({
                currentResource: personWithLinks(['uuid-a']),
                resourceToValidateJson: personWithLinks(['uuid-a', 'uuid-any-tenant-person']),
                isUser: false,
                user: 'admin',
                scope: 'access/*.*',
                base_version: '4_0_0'
            });

            expect(result).toBeNull();
            expect(mockFindAsync).not.toHaveBeenCalled();
        });

        it('does not re-check links that were already present (only additions are validated)', async () => {
            const result = await personResourceValidator.validatePatientReference({
                currentResource: personWithLinks(['uuid-a', 'uuid-b']),
                resourceToValidateJson: personWithLinks(['uuid-a', 'uuid-b']),
                isUser: false,
                user: 'service@tenant_a',
                scope: 'access/tenant_a.*',
                base_version: '4_0_0'
            });

            expect(result).toBeNull();
            expect(mockFindAsync).not.toHaveBeenCalled();
        });

        it('allows linking to a target that cannot be found (left to other validation)', async () => {
            resolveTargetsAs([]);

            const result = await personResourceValidator.validatePatientReference({
                currentResource: personWithLinks(['uuid-a']),
                resourceToValidateJson: personWithLinks(['uuid-a', 'uuid-not-found']),
                isUser: false,
                user: 'service@tenant_a',
                scope: 'access/tenant_a.*',
                base_version: '4_0_0'
            });

            expect(result).toBeNull();
        });

        it('fails closed when a bare-id reference resolves to multiple candidates and any is inaccessible', async () => {
            // a bare id (no |sourceAssigningAuthority suffix) can collide across tenants; this
            // must not silently pick one of the candidates -- it has to reject if ANY of them
            // belongs to a tenant the caller can't access
            resolveTargetsAs([
                {
                    resourceType: 'Person',
                    id: 'ambiguous-id',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'tenant_a' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenant_a' }
                        ]
                    }
                },
                {
                    resourceType: 'Person',
                    id: 'ambiguous-id',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'tenant_b' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenant_b' }
                        ]
                    }
                }
            ]);

            const result = await personResourceValidator.validatePatientReference({
                currentResource: personWithLinks(['uuid-a']),
                resourceToValidateJson: personWithLinks(['uuid-a', 'ambiguous-id']),
                isUser: false,
                user: 'service@tenant_a',
                scope: 'access/tenant_a.*',
                base_version: '4_0_0'
            });

            expect(result).not.toBeNull();
            const issue = Array.isArray(result.issue) ? result.issue[0] : result.issue;
            expect(issue.details.text).toContain('does not have access');
        });

        it('allows a bare-id reference that resolves to multiple candidates when all are accessible', async () => {
            resolveTargetsAs([
                {
                    resourceType: 'Person',
                    id: 'shared-id',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'tenant_a' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenant_a' }
                        ]
                    }
                },
                {
                    resourceType: 'Person',
                    id: 'shared-id',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'tenant_a' },
                            { system: 'https://www.icanbwell.com/access', code: 'tenant_a' }
                        ]
                    }
                }
            ]);

            const result = await personResourceValidator.validatePatientReference({
                currentResource: personWithLinks(['uuid-a']),
                resourceToValidateJson: personWithLinks(['uuid-a', 'shared-id']),
                isUser: false,
                user: 'service@tenant_a',
                scope: 'access/tenant_a.*',
                base_version: '4_0_0'
            });

            expect(result).toBeNull();
        });
    });

    describe('validateResourceSizeSync', () => {
        it('returns null for non-AuditEvent resources regardless of size', () => {
            const resource = { resourceType: 'Observation', data: 'x'.repeat(10000000) };
            const result = resourceValidator.validateResourceSizeSync({ resource, resourceType: 'Observation' });
            expect(result).toBeNull();
        });

        it('returns null for AuditEvent within size limit', () => {
            const resource = { resourceType: 'AuditEvent', id: 'ae-1' };
            const result = resourceValidator.validateResourceSizeSync({ resource, resourceType: 'AuditEvent' });
            expect(result).toBeNull();
        });

        it('returns OperationOutcome for oversized AuditEvent', () => {
            mockConfigManager.auditEventMaxSizeBytes = 100;
            const resource = { resourceType: 'AuditEvent', id: 'ae-1', description: 'x'.repeat(200) };
            const result = resourceValidator.validateResourceSizeSync({ resource, resourceType: 'AuditEvent' });
            expect(result).not.toBeNull();
            expect(result.issue[0].code).toBe('too-long');
        });
    });

    describe('validateResourceAsync', () => {
        it('returns null when resource passes local validation', async () => {
            mockConfigManager.fhirValidationUrl = null;

            // Supply a valid Observation that will pass schema validation
            const validObservation = {
                resourceType: 'Observation',
                id: 'obs-1',
                status: 'final',
                code: { coding: [{ system: 'http://loinc.org', code: '12345' }] },
                meta: { lastUpdated: '2024-01-01' }
            };

            const result = await resourceValidator.validateResourceAsync({
                base_version: '4_0_0',
                requestInfo: { isUser: false },
                id: 'obs-1',
                resourceType: 'Observation',
                resourceToValidate: validObservation,
                path: '/4_0_0/Observation'
            });

            expect(result).toBeNull();
        });

        it('returns validation error when resource fails schema validation', async () => {
            mockConfigManager.fhirValidationUrl = null;

            // Supply an invalid Observation missing required fields
            const invalidObservation = {
                resourceType: 'Observation',
                id: 'obs-1'
                // missing status and code
            };

            const result = await resourceValidator.validateResourceAsync({
                base_version: '4_0_0',
                requestInfo: { isUser: false },
                id: 'obs-1',
                resourceType: 'Observation',
                resourceToValidate: invalidObservation,
                path: '/4_0_0/Observation'
            });

            expect(result).not.toBeNull();
            expect(result.resourceType).toBe('OperationOutcome');
        });

        it('validates patient reference when schema validation passes and currentResource provided', async () => {
            mockConfigManager.fhirValidationUrl = null;
            mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');

            const validObservation = {
                resourceType: 'Observation',
                id: 'obs-1',
                status: 'final',
                code: { coding: [{ system: 'http://loinc.org', code: '12345' }] },
                subject: { reference: 'Patient/p2' }
            };

            const currentResource = { resourceType: 'Observation', id: 'obs-1', subject: { reference: 'Patient/p1' } };
            const result = await resourceValidator.validateResourceAsync({
                base_version: '4_0_0',
                requestInfo: { isUser: true },
                id: 'obs-1',
                resourceType: 'Observation',
                resourceToValidate: validObservation,
                path: '/4_0_0/Observation',
                currentResource
            });

            expect(result).not.toBeNull();
            const issueItem = Array.isArray(result.issue) ? result.issue[0] : result.issue;
            expect(issueItem.details.text).toContain('did not match');
        });
    });

    describe('createProfileResourceFromJson', () => {
        it('creates StructureDefinition with owner security tag using publisher', () => {
            const profileJson = {
                resourceType: 'StructureDefinition',
                id: 'profile-1',
                url: 'http://example.com/profile',
                publisher: 'MyOrg',
                status: 'active',
                kind: 'resource',
                abstract: false,
                type: 'Patient'
            };

            const result = resourceValidator.createProfileResourceFromJson({ profileJson });

            expect(result.id).toBe('profile-1');
            const ownerTag = result.meta.security.find(s => s.system === 'https://www.icanbwell.com/owner');
            expect(ownerTag.code).toBe('MyOrg');
        });

        it('uses "profile" as owner code when publisher is missing', () => {
            const profileJson = {
                resourceType: 'StructureDefinition',
                id: 'profile-2',
                url: 'http://example.com/profile2',
                status: 'active',
                kind: 'resource',
                abstract: false,
                type: 'Patient'
            };

            const result = resourceValidator.createProfileResourceFromJson({ profileJson });

            const ownerTag = result.meta.security.find(s => s.system === 'https://www.icanbwell.com/owner');
            expect(ownerTag.code).toBe('profile');
        });

        it('sets meta.source from url when source is missing', () => {
            const profileJson = {
                resourceType: 'StructureDefinition',
                id: 'profile-3',
                url: 'http://example.com/profile3',
                status: 'active',
                kind: 'resource',
                abstract: false,
                type: 'Observation'
            };

            const result = resourceValidator.createProfileResourceFromJson({ profileJson });
            expect(result.meta.source).toBe('http://example.com/profile3');
        });

        it('appends owner tag to existing security array', () => {
            const profileJson = {
                resourceType: 'StructureDefinition',
                id: 'profile-4',
                url: 'http://example.com/profile4',
                publisher: 'Org',
                status: 'active',
                kind: 'resource',
                abstract: false,
                type: 'Patient',
                meta: {
                    security: [{ system: 'https://www.icanbwell.com/access', code: 'read' }]
                }
            };

            const result = resourceValidator.createProfileResourceFromJson({ profileJson });
            expect(result.meta.security.length).toBe(2);
        });
    });

    describe('upsertProfileInRemoteServer', () => {
        it('fetches profile from remote when not in database', async () => {
            const mockCursor = { hasNext: jest.fn().mockResolvedValue(false), nextObject: jest.fn() };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: jest.fn().mockResolvedValue(mockCursor) });

            const mockUpdateManager = { replaceOneAsync: jest.fn().mockResolvedValue(null) };
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jest.fn().mockReturnValue(mockUpdateManager);

            mockRemoteFhirValidator.fetchProfileAsync = jest.fn().mockResolvedValue({
                resourceType: 'StructureDefinition', id: 'sd-1', url: 'http://example.com/profile',
                status: 'active', kind: 'resource', abstract: false, type: 'Patient'
            });
            mockRemoteFhirValidator.updateProfileAsync = jest.fn().mockResolvedValue(null);

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'test';
            requestInfo.scope = 'system/*.*';

            await resourceValidator.upsertProfileInRemoteServer({
                base_version: '4_0_0',
                requestInfo,
                profile: 'http://example.com/profile',
                resourceType: 'Patient'
            });

            expect(mockRemoteFhirValidator.fetchProfileAsync).toHaveBeenCalledWith({ url: 'http://example.com/profile' });
            expect(mockUpdateManager.replaceOneAsync).toHaveBeenCalled();
            expect(mockRemoteFhirValidator.updateProfileAsync).toHaveBeenCalled();
        });

        it('throws BadRequestError when profile URL returns 404', async () => {
            const mockCursor = { hasNext: jest.fn().mockResolvedValue(false), nextObject: jest.fn() };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: jest.fn().mockResolvedValue(mockCursor) });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jest.fn().mockReturnValue({});

            const error404 = new Error('Not Found');
            error404.response = { status: 404 };
            mockRemoteFhirValidator.fetchProfileAsync = jest.fn().mockRejectedValue(error404);

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'test';
            requestInfo.scope = 'system/*.*';

            await expect(resourceValidator.upsertProfileInRemoteServer({
                base_version: '4_0_0',
                requestInfo,
                profile: 'http://example.com/missing-profile',
                resourceType: 'Patient'
            })).rejects.toThrow('Unable to fetch profile details');
        });

        it('skips remote fetch when profile already in database', async () => {
            const existingProfile = {
                id: 'sd-1',
                url: 'http://example.com/profile',
                toJSON: () => ({ id: 'sd-1', url: 'http://example.com/profile', resourceType: 'StructureDefinition' })
            };
            const mockCursor = {
                hasNext: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
                nextObject: jest.fn().mockResolvedValue(existingProfile)
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({ findAsync: jest.fn().mockResolvedValue(mockCursor) });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jest.fn().mockReturnValue({});
            mockRemoteFhirValidator.fetchProfileAsync = jest.fn();
            mockRemoteFhirValidator.updateProfileAsync = jest.fn().mockResolvedValue(null);

            const requestInfo = Object.create(FhirRequestInfo.prototype);
            requestInfo.user = 'test';
            requestInfo.scope = 'system/*.*';

            await resourceValidator.upsertProfileInRemoteServer({
                base_version: '4_0_0',
                requestInfo,
                profile: 'http://example.com/profile',
                resourceType: 'Patient'
            });

            expect(mockRemoteFhirValidator.fetchProfileAsync).not.toHaveBeenCalled();
            expect(mockRemoteFhirValidator.updateProfileAsync).toHaveBeenCalled();
        });
    });
});
