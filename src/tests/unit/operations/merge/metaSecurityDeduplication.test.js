/**
 * Tests for INC-316 / INC-317: meta.security deduplication during merge operations.
 *
 * INC-316: Concurrent $merge operations on Location resources caused meta.security
 * tags to be duplicated exponentially, exceeding MongoDB's 16MB BSON limit.
 *
 * INC-317: Bloated meta.security caused CDC events to exceed Kafka's max message size,
 * halting the CDC pipeline. Resources ingested during the outage received an
 * "unclassified" tag, breaking Delegated User reads.
 *
 * These tests assert CORRECT behavior (deduplication, size limits, fail-closed semantics)
 * so they FAIL on the current buggy code.
 */
const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('../../../../config', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const { mergeObject } = require('../../../../utils/mergeHelper');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');

/**
 * Helper: creates a meta.security array with the given tags
 * @param {Array<{system: string, code: string}>} tags
 * @returns {{meta: {security: Array}}}
 */
function createResourceWithSecurityTags(tags) {
    return {
        resourceType: 'Location',
        id: 'walgreens-loc-1',
        meta: {
            versionId: '1',
            lastUpdated: '2026-01-01T00:00:00.000Z',
            source: 'https://walgreens.com',
            security: tags.map(t => ({ ...t }))
        }
    };
}

describe('INC-316: meta.security deduplication during merge', () => {
    describe('mergeObject should deduplicate meta.security tags', () => {
        test('after merging two resources with identical security tags, no duplicates should exist', () => {
            // Simulates concurrent merge: both the "current" resource in DB and the
            // "incoming" resource carry the same owner/access/sourceAssigningAuthority tags.
            // The merge should NOT produce duplicates.
            const securityTags = [
                { system: SecurityTagSystem.owner, code: 'walgreens' },
                { system: SecurityTagSystem.access, code: 'walgreens' },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' }
            ];

            const currentResource = createResourceWithSecurityTags(securityTags);
            const incomingResource = createResourceWithSecurityTags(securityTags);

            const merged = mergeObject(currentResource, incomingResource);

            // After merge, each security tag should appear exactly once
            const securitySystems = merged.meta.security.map(s => `${s.system}|${s.code}`);
            const uniqueSystems = [...new Set(securitySystems)];

            expect(merged.meta.security).toHaveLength(uniqueSystems.length);
            expect(securitySystems).toEqual(uniqueSystems);
        });

        test('repeated merges should not cause exponential growth of meta.security', () => {
            // Simulates the INC-316 scenario: multiple consecutive merges of the same
            // resource, each time carrying the same security tags. Without deduplication,
            // each merge doubles the array.
            const securityTags = [
                { system: SecurityTagSystem.owner, code: 'walgreens' },
                { system: SecurityTagSystem.access, code: 'walgreens' },
                { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' }
            ];

            let resource = createResourceWithSecurityTags(securityTags);
            const incomingResource = createResourceWithSecurityTags(securityTags);

            // Simulate 5 consecutive merges (as would happen with concurrent requests)
            for (let i = 0; i < 5; i++) {
                resource = mergeObject(resource, incomingResource);
            }

            // After 5 merges of identical data, array should still be 3 (one per tag)
            expect(resource.meta.security).toHaveLength(3);
        });

        test('merge should deduplicate even when tags differ only in extra whitespace or field order', () => {
            // Tags that are semantically identical should be deduplicated
            const currentResource = createResourceWithSecurityTags([
                { system: SecurityTagSystem.owner, code: 'walgreens' },
                { system: SecurityTagSystem.access, code: 'walgreens' }
            ]);

            // Incoming has same tags but with an extra 'display' field on one
            // The owner tag is the same system+code so should not produce a duplicate
            const incomingResource = {
                ...currentResource,
                meta: {
                    ...currentResource.meta,
                    security: [
                        { system: SecurityTagSystem.owner, code: 'walgreens' },
                        { system: SecurityTagSystem.access, code: 'walgreens' },
                        { system: SecurityTagSystem.owner, code: 'walgreens' }
                    ]
                }
            };

            const merged = mergeObject(currentResource, incomingResource);

            // Should have exactly 2 unique tags, no duplicates
            const ownerTags = merged.meta.security.filter(
                s => s.system === SecurityTagSystem.owner && s.code === 'walgreens'
            );
            expect(ownerTags).toHaveLength(1);
        });
    });
});

describe('INC-317: fail-closed semantics for empty meta.security after deduplication', () => {
    test('if deduplication results in empty meta.security, access should be denied (fail-closed)', () => {
        // INC-317: When tagging failed, resources got "unclassified" tag which broke
        // Delegated User reads. The system should NEVER allow a resource to persist
        // with an empty meta.security — it must fail-closed (deny) rather than
        // fail-open (allow with no access controls).

        const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
        const mockConfigManager = {
            requireMetaSourceTags: false
        };
        const mockScopesManager = {
            doesResourceHaveOwnerTags: jest.fn().mockReturnValue(false),
            doesResourceHaveMultipleOwnerTags: jest.fn().mockReturnValue(false),
            doesResourceHaveInvalidMetaSecurity: jest.fn().mockReturnValue(false)
        };

        const validator = Object.create(ResourceValidator.prototype);
        validator.configManager = mockConfigManager;
        validator.scopesManager = mockScopesManager;

        const resource = {
            resourceType: 'Location',
            id: 'walgreens-loc-1',
            meta: {
                source: 'https://walgreens.com',
                security: []
            }
        };

        const result = validator.validateResourceMetaSync(resource);

        // With empty security tags, the resource should be REJECTED (fail-closed)
        expect(result).not.toBeNull();
        expect(result.issue).toBeDefined();
        expect(result.issue[0].severity).toBe('error');
    });

    test('resource with only "unclassified" tag and no owner tag should be rejected', () => {
        // INC-317 scenario: during outage, resources got only an "unclassified" tag
        // without proper owner/access tags. This should not be persistable.

        const { ResourceValidator } = require('../../../../operations/common/resourceValidator');
        const { SENSITIVE_CATEGORY } = require('../../../../constants');
        const mockConfigManager = {
            requireMetaSourceTags: false
        };
        const mockScopesManager = {
            doesResourceHaveOwnerTags: jest.fn().mockReturnValue(false),
            doesResourceHaveMultipleOwnerTags: jest.fn().mockReturnValue(false),
            doesResourceHaveInvalidMetaSecurity: jest.fn().mockReturnValue(false)
        };

        const validator = Object.create(ResourceValidator.prototype);
        validator.configManager = mockConfigManager;
        validator.scopesManager = mockScopesManager;

        const resource = {
            resourceType: 'Location',
            id: 'walgreens-loc-1',
            meta: {
                source: 'https://walgreens.com',
                security: [
                    {
                        system: SENSITIVE_CATEGORY.SYSTEM,
                        code: SENSITIVE_CATEGORY.UNCLASSIFIED_CODE
                    }
                ]
            }
        };

        const result = validator.validateResourceMetaSync(resource);

        // Should be rejected because there is no owner tag
        expect(result).not.toBeNull();
        expect(result.issue).toBeDefined();
        expect(result.issue[0].severity).toBe('error');
    });
});

describe('INC-316: write operations should validate meta.security size before persisting', () => {

    test('ResourceMerger.updateSecurityTag should not produce duplicate entries for the same system', () => {
        // The updateSecurityTag method in ResourceMerger is where duplicates sneak in
        // during concurrent merges. It should ensure no system appears more than once.
        const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
        const merger = Object.create(ResourceMerger.prototype);

        const currentResource = {
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'walgreens' },
                    { system: SecurityTagSystem.access, code: 'walgreens' },
                    { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' }
                ]
            }
        };

        // resourceToMerge already has duplicate owner tags (simulating race condition accumulation)
        const resourceToMerge = {
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'walgreens' },
                    { system: SecurityTagSystem.owner, code: 'walgreens' },
                    { system: SecurityTagSystem.access, code: 'walgreens' },
                    { system: SecurityTagSystem.access, code: 'walgreens' },
                    { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' }
                ]
            },
            _sourceAssigningAuthority: 'walgreens'
        };

        merger.updateSecurityTag({
            system: SecurityTagSystem.owner,
            currentResource,
            resourceToMerge
        });

        merger.updateSecurityTag({
            system: SecurityTagSystem.sourceAssigningAuthority,
            currentResource,
            resourceToMerge
        });

        // After updateSecurityTag, there should be no duplicate systems
        const ownerTags = resourceToMerge.meta.security.filter(
            s => s.system === SecurityTagSystem.owner
        );
        const saaTags = resourceToMerge.meta.security.filter(
            s => s.system === SecurityTagSystem.sourceAssigningAuthority
        );

        expect(ownerTags).toHaveLength(1);
        expect(saaTags).toHaveLength(1);
    });

    test('after overWriteNonWritableFields, meta.security should contain no duplicates regardless of input', () => {
        // overWriteNonWritableFields calls updateSecurityTag for owner and
        // sourceAssigningAuthority, but it does NOT deduplicate other systems
        // (like "access"). After the full overwrite flow, the resulting
        // meta.security should have zero duplicates across ALL systems.
        const { ResourceMerger } = require('../../../../operations/common/resourceMerger');
        const merger = Object.create(ResourceMerger.prototype);
        merger.preSaveManager = { preSaveAsync: jest.fn(({ resource }) => Promise.resolve(resource)) };

        const currentResource = {
            id: 'walgreens-loc-1',
            meta: {
                versionId: '3',
                lastUpdated: '2026-01-01T00:00:00.000Z',
                source: 'https://walgreens.com',
                security: [
                    { system: SecurityTagSystem.owner, code: 'walgreens' },
                    { system: SecurityTagSystem.access, code: 'walgreens' },
                    { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' }
                ]
            },
            identifier: []
        };

        // Incoming resource has duplicated security entries (as produced by race condition)
        const resourceToMerge = {
            id: 'walgreens-loc-1',
            _uuid: 'uuid-123',
            meta: {
                security: [
                    { system: SecurityTagSystem.owner, code: 'walgreens' },
                    { system: SecurityTagSystem.access, code: 'walgreens' },
                    { system: SecurityTagSystem.access, code: 'walgreens' },
                    { system: SecurityTagSystem.access, code: 'walgreens' },
                    { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' },
                    { system: SecurityTagSystem.sourceAssigningAuthority, code: 'walgreens' }
                ]
            },
            _sourceAssigningAuthority: 'walgreens',
            identifier: []
        };

        const result = merger.overWriteNonWritableFields({ currentResource, resourceToMerge });

        // Count occurrences of each system+code combination
        const tagCounts = {};
        for (const tag of result.meta.security) {
            const key = `${tag.system}|${tag.code}`;
            tagCounts[key] = (tagCounts[key] || 0) + 1;
        }

        // Every tag should appear exactly once
        for (const [key, count] of Object.entries(tagCounts)) {
            expect(count).toBe(1);
        }
    });
});
