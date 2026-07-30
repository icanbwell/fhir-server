const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('express-http-context', () => {
    const { jest: j } = require('@jest/globals');
    return { get: j.fn(), set: j.fn() };
});

jest.mock('../../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return { logInfo: j.fn(), logError: j.fn(), logDebug: j.fn() };
});

jest.mock('../../../../utils/uid.util', () => {
    const { jest: j } = require('@jest/globals');
    let callCount = 0;
    return { generateUUID: j.fn(() => `generated-uuid-${++callCount}`) };
});

jest.mock('../../../../fhir/fhirResourceCreator', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceCreator: {
            createByResourceType: j.fn((json, resourceType) => ({
                ...json,
                resourceType,
                id: json.id,
                _uuid: json._uuid || `uuid-${json.id}`,
                _sourceAssigningAuthority: json._sourceAssigningAuthority || 'test',
                meta: json.meta || { security: [] },
                toJSON: () => json,
                toJSONInternal: () => json,
                clone: () => ({ ...json })
            }))
        }
    };
});

jest.mock('../../../../fhir/fhirResourceSerializer', () => {
    const { jest: j } = require('@jest/globals');
    return {
        FhirResourceSerializer: {
            serialize: j.fn((json) => ({ ...json, _serialized: true }))
        }
    };
});

jest.mock('../../../../utils/contextDataBuilder', () => {
    const { jest: j } = require('@jest/globals');
    return { buildContextDataForHybridStorage: j.fn(() => null) };
});

const { CreateOperation } = require('../../../../operations/create/create');
const { AuditLogger } = require('../../../../utils/auditLogger');
const { PostRequestProcessor } = require('../../../../utils/postRequestProcessor');
const { FhirLoggingManager } = require('../../../../operations/common/fhirLoggingManager');
const { ScopesValidator } = require('../../../../operations/security/scopesValidator');
const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
const { DatabaseBulkInserter } = require('../../../../dataLayer/databaseBulkInserter');
const { ConfigManager } = require('../../../../utils/configManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { IdentifierEnrichmentProvider } = require('../../../../enrich/providers/identifierEnrichmentProvider');

function createMockInstance(ClassType) {
    return Object.create(ClassType.prototype);
}

describe('CreateOperation - INC-322 Rate Limiting & Consent Protections', () => {
    let createOp;
    let mocks;
    let mockParsedArgs;

    beforeEach(() => {
        mocks = {
            auditLogger: createMockInstance(AuditLogger),
            postRequestProcessor: createMockInstance(PostRequestProcessor),
            fhirLoggingManager: createMockInstance(FhirLoggingManager),
            scopesValidator: createMockInstance(ScopesValidator),
            resourceValidator: createMockInstance(ResourceValidator),
            databaseBulkInserter: createMockInstance(DatabaseBulkInserter),
            configManager: createMockInstance(ConfigManager),
            databaseAttachmentManager: createMockInstance(DatabaseAttachmentManager),
            base64DataManager: createMockInstance(Base64DataManager),
            identifierEnrichmentProvider: createMockInstance(IdentifierEnrichmentProvider)
        };

        // Setup default mocks
        mocks.scopesValidator.verifyHasValidScopesAsync = jest.fn().mockResolvedValue(undefined);
        mocks.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes = jest.fn().mockResolvedValue(undefined);
        mocks.resourceValidator.validateResourceAsync = jest.fn().mockResolvedValue(null);
        mocks.resourceValidator.validateResourceMetaSync = jest.fn().mockReturnValue(null);
        mocks.resourceValidator.validateResourceSizeSync = jest.fn().mockReturnValue(null);
        mocks.databaseBulkInserter.insertOneAsync = jest.fn().mockResolvedValue(undefined);
        mocks.databaseBulkInserter.executeAsync = jest.fn().mockResolvedValue([{
            created: true, updated: false, id: 'generated-uuid-1', uuid: 'generated-uuid-1',
            resourceType: 'Person', sourceAssigningAuthority: 'test'
        }]);
        mocks.databaseAttachmentManager.transformAttachments = jest.fn((doc) => Promise.resolve(doc));
        mocks.base64DataManager.transformAsync = jest.fn((doc) => Promise.resolve(doc));
        mocks.fhirLoggingManager.logOperationSuccessAsync = jest.fn().mockResolvedValue(undefined);
        mocks.fhirLoggingManager.logOperationFailureAsync = jest.fn().mockResolvedValue(undefined);
        mocks.postRequestProcessor.add = jest.fn();
        mocks.auditLogger.logAuditEntryAsync = jest.fn().mockResolvedValue(undefined);
        mocks.identifierEnrichmentProvider.enrichIdentifierList = jest.fn();

        mockParsedArgs = createMockInstance(ParsedArgs);
        mockParsedArgs.base_version = '4_0_0';
        mockParsedArgs.getRawArgs = jest.fn().mockReturnValue({});

        createOp = new CreateOperation(mocks);
    });

    describe('Person creation rate limiting', () => {
        /**
         * INC-322: Samsung devices caused ~2.4M Person records/day (1800x normal).
         * The CreateOperation should enforce rate limiting on Person resource creation
         * to prevent a single client/tenant from creating excessive resources.
         *
         * Expected behavior: After exceeding a threshold of Person creates per client
         * within a time window, subsequent creates should be rejected with a 429
         * (Too Many Requests) or equivalent error.
         *
         * This test FAILS because the code has NO rate limiting — it accepts
         * unlimited Person creates without any throttling.
         */
        test('should reject Person creation when rate limit is exceeded for a client', async () => {
            const clientId = 'samsung-health-app';
            const requestInfo = {
                user: clientId,
                body: {
                    resourceType: 'Person',
                    meta: { security: [] },
                    name: [{ family: 'TestUser', given: ['Device'] }],
                    telecom: [{ system: 'phone', value: '555-0100' }]
                },
                requestId: 'r1'
            };

            // Simulate rapid successive Person creates from the same client
            // A rate limiter should block after a reasonable threshold
            const createPromises = [];
            const rateLimitThreshold = 100; // reasonable per-minute limit per client

            for (let i = 0; i < rateLimitThreshold + 1; i++) {
                createPromises.push(
                    createOp.createAsync({
                        requestInfo: { ...requestInfo, requestId: `r-${i}` },
                        parsedArgs: mockParsedArgs,
                        path: '/Person',
                        resourceType: 'Person'
                    })
                );
            }

            const results = await Promise.allSettled(createPromises);

            // At least one request beyond the threshold should be rejected
            const rejected = results.filter(r => r.status === 'rejected');
            expect(rejected.length).toBeGreaterThan(0);

            // The rejection should indicate rate limiting (429 / TooManyRequests)
            const rateLimitError = rejected[0].reason;
            expect(rateLimitError.message).toMatch(/rate limit|too many requests|throttled/i);
        });

        /**
         * INC-322: The system should have per-resource-type awareness for rate limits.
         * Person resources are particularly sensitive because they represent identity
         * records and trigger downstream token minting in Redis.
         *
         * Expected behavior: Person resource creation should have stricter rate limits
         * than other resource types, or at minimum have SOME rate limiting check.
         *
         * This test FAILS because CreateOperation.createAsync has zero rate-limiting
         * logic — it proceeds directly to database insertion regardless of volume.
         */
        test('should enforce stricter rate limits on Person resources than general resources', async () => {
            const requestInfo = {
                user: 'burst-client',
                body: {
                    resourceType: 'Person',
                    meta: { security: [] },
                    name: [{ family: 'Flood', given: ['Attack'] }]
                },
                requestId: 'r1'
            };

            // The CreateOperation should check rate limits before proceeding.
            // We verify this by checking if any rate-limiting service is consulted.
            // If the code has rate limiting, it would call a rate limiter before insertion.
            const result = await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/Person',
                resourceType: 'Person'
            });

            // If rate limiting exists, the operation should have consulted a rate limiter.
            // Since the code has NO rate limiting, this will fail — the resource is created
            // directly without any throttle check.
            expect(createOp).toHaveProperty('rateLimiter');
            expect(createOp.rateLimiter).toBeDefined();
            expect(createOp.rateLimiter.checkLimit).toHaveBeenCalled();
        });
    });

    describe('Person creation consent verification', () => {
        /**
         * INC-322: 5M+ unconsented Person records were created in 72 hours.
         * The system MUST verify that Terms of Service (TOS) consent exists before
         * creating a Person resource, as Person represents a real individual whose
         * data handling is governed by consent agreements.
         *
         * Expected behavior: Creating a Person resource without a valid TOS consent
         * reference should be rejected with a clear error indicating consent is required.
         *
         * This test FAILS because CreateOperation has no consent verification logic.
         */
        test('should reject Person creation when TOS consent is not present', async () => {
            const requestInfo = {
                user: 'samsung-health-app',
                body: {
                    resourceType: 'Person',
                    meta: { security: [] },
                    name: [{ family: 'NoConsent', given: ['User'] }],
                    telecom: [{ system: 'email', value: 'noconsent@example.com' }]
                    // NOTE: No consent reference, no TOS acceptance indicator
                },
                requestId: 'r-no-consent'
            };

            // Person creation without TOS consent should be rejected
            await expect(
                createOp.createAsync({
                    requestInfo,
                    parsedArgs: mockParsedArgs,
                    path: '/Person',
                    resourceType: 'Person'
                })
            ).rejects.toThrow(/consent|tos|terms of service/i);
        });

        /**
         * INC-322: Even if the request has proper scopes, Person creation should
         * additionally verify consent status. Scopes authorize API access but do NOT
         * constitute user consent for data processing.
         *
         * Expected behavior: The system should check for an active Consent resource
         * (category: TOS, status: active) linked to the Person being created,
         * OR require a consent indicator in the request context.
         *
         * This test FAILS because the only authorization check is scopesValidator
         * which only validates OAuth scopes, not user consent.
         */
        test('should verify consent status even when scopes are valid', async () => {
            // Scopes pass fine
            mocks.scopesValidator.verifyHasValidScopesAsync.mockResolvedValue(undefined);

            const requestInfo = {
                user: 'authorized-client',
                body: {
                    resourceType: 'Person',
                    meta: { security: [] },
                    name: [{ family: 'Authorized', given: ['ButNoConsent'] }]
                },
                requestId: 'r-scoped-no-consent',
                // No consent token or consent reference in the request
                consentVerified: false
            };

            // Even though scopes are valid, Person creation should still require consent
            const result = await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/Person',
                resourceType: 'Person'
            });

            // If consent checking exists, the operation should NOT succeed without consent.
            // This assertion fails because the code creates the Person regardless.
            expect(result).toBeUndefined();
        });
    });

    describe('Bulk duplicate Person resource deduplication', () => {
        /**
         * INC-322: Samsung devices sent identical Person creation requests repeatedly,
         * creating millions of duplicate records. The system should detect and deduplicate
         * identical Person resources rather than blindly creating new records each time.
         *
         * Expected behavior: When a Person resource is submitted with the same identifying
         * information (name + telecom + birthDate) as an existing Person, the system should
         * return the existing resource rather than creating a duplicate.
         *
         * This test FAILS because CreateOperation always generates a new UUID and inserts
         * without checking for existing matching resources.
         */
        test('should deduplicate identical Person resources instead of creating duplicates', async () => {
            const personBody = {
                resourceType: 'Person',
                meta: { security: [] },
                name: [{ family: 'Duplicate', given: ['Person'] }],
                telecom: [{ system: 'phone', value: '555-9999' }],
                birthDate: '1990-01-01'
            };

            const requestInfo1 = {
                user: 'samsung-device-1',
                body: { ...personBody },
                requestId: 'r-dup-1'
            };

            const requestInfo2 = {
                user: 'samsung-device-1',
                body: { ...personBody },
                requestId: 'r-dup-2'
            };

            // First creation succeeds
            const result1 = await createOp.createAsync({
                requestInfo: requestInfo1,
                parsedArgs: mockParsedArgs,
                path: '/Person',
                resourceType: 'Person'
            });

            // Second creation with identical data should NOT create a new resource.
            // It should return the existing one or reject with a conflict.
            const result2 = await createOp.createAsync({
                requestInfo: requestInfo2,
                parsedArgs: mockParsedArgs,
                path: '/Person',
                resourceType: 'Person'
            });

            // The two results should reference the same resource (deduplication)
            // OR the second call should have been rejected.
            // This fails because CreateOperation generates a fresh UUID each time
            // and inserts unconditionally — no dedup check exists.
            expect(result2.id).toBe(result1.id);
        });

        /**
         * INC-322: The database inserter was called for every single request without
         * any duplicate checking. With 2.4M requests/day, this caused Redis memory
         * exhaustion from minted tokens and cascading failures.
         *
         * Expected behavior: Before inserting a Person, the system should query for
         * existing Person resources matching the same identifiers to avoid duplicates.
         *
         * This test FAILS because databaseBulkInserter.insertOneAsync is called
         * directly without any prior existence check.
         */
        test('should check for existing Person before inserting a new one', async () => {
            const requestInfo = {
                user: 'samsung-device-2',
                body: {
                    resourceType: 'Person',
                    meta: { security: [] },
                    identifier: [
                        { system: 'urn:samsung:device-id', value: 'DEVICE-ABC-123' }
                    ],
                    name: [{ family: 'Samsung', given: ['User'] }]
                },
                requestId: 'r-check-existing'
            };

            await createOp.createAsync({
                requestInfo,
                parsedArgs: mockParsedArgs,
                path: '/Person',
                resourceType: 'Person'
            });

            // The system should have performed a lookup for existing Person resources
            // with matching identifiers BEFORE calling insertOneAsync.
            // This fails because the code calls insertOneAsync directly with no prior query.
            const insertCalls = mocks.databaseBulkInserter.insertOneAsync.mock.calls;
            expect(insertCalls.length).toBe(0); // Should not insert if match found

            // Alternatively, there should be evidence of a deduplication/lookup call
            // before insertion. The code has no such mechanism.
            expect(createOp).toHaveProperty('personDeduplicationService');
        });

        /**
         * INC-322: With no deduplication, the same device could create unlimited
         * Person records. The system should track creation fingerprints and reject
         * requests that would create duplicate resources within a time window.
         *
         * Expected behavior: A fingerprint (hash of key Person fields) should be
         * checked against recent creations. If a matching fingerprint exists within
         * a configurable window (e.g., 24 hours), the create should be rejected
         * as a duplicate.
         *
         * This test FAILS because no fingerprinting or dedup window logic exists.
         */
        test('should reject duplicate Person creation within deduplication window', async () => {
            const identicalBody = {
                resourceType: 'Person',
                meta: { security: [] },
                identifier: [
                    { system: 'urn:samsung:device-id', value: 'DEVICE-XYZ-789' }
                ],
                name: [{ family: 'Repeat', given: ['Offender'] }],
                telecom: [{ system: 'phone', value: '555-0001' }]
            };

            // First request succeeds
            await createOp.createAsync({
                requestInfo: {
                    user: 'samsung-app',
                    body: { ...identicalBody },
                    requestId: 'r-first'
                },
                parsedArgs: mockParsedArgs,
                path: '/Person',
                resourceType: 'Person'
            });

            // Immediate second request with identical body should be rejected as duplicate
            await expect(
                createOp.createAsync({
                    requestInfo: {
                        user: 'samsung-app',
                        body: { ...identicalBody },
                        requestId: 'r-second'
                    },
                    parsedArgs: mockParsedArgs,
                    path: '/Person',
                    resourceType: 'Person'
                })
            ).rejects.toThrow(/duplicate|already exists|conflict/i);
        });
    });
});
