'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock the generated JSON files
jestGlobal.mock('../../../../operations/everything/generated.non_clinical_resources_fields.json', () => ({
    DocumentReference: [
        'subject._uuid',
        'author._uuid',
        'content.attachment.url'
    ],
    Encounter: [
        'participant.individual._uuid',
        'serviceProvider._uuid'
    ],
    Observation: [
        'performer._uuid'
    ]
}), { virtual: true });

jestGlobal.mock('../../../../operations/everything/generated.resource_types.json', () => ({
    nonClinicalResources: [
        'Organization',
        'Practitioner',
        'Location',
        'Binary',
        'HealthcareService'
    ],
    clinicalResources: [
        'Patient',
        'Encounter',
        'Observation',
        'DocumentReference'
    ]
}), { virtual: true });

// Mock uid.util - generateUUIDv5 produces deterministic UUIDs based on input
jestGlobal.mock('../../../../utils/uid.util', () => {
    const crypto = require('crypto');
    return {
        isUuid: (text) => {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
            return text && uuidRegex.test(text);
        },
        generateUUIDv5: (name) => {
            // Produce a deterministic UUID-like string from the input name
            const hash = crypto.createHash('md5').update(name).digest('hex');
            return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
        }
    };
});

const { NonClinicalReferencesExtractor } = require('../../../../operations/everything/nonClinicalResourceExtractor');

describe('NonClinicalReferencesExtractor', () => {
    let extractor;

    beforeEach(() => {
        extractor = new NonClinicalReferencesExtractor({
            resourcesTypeToExclude: [],
            resourcePool: null
        });
    });

    describe('Happy path - extracting non-clinical references', () => {
        test('should extract Organization reference from Encounter.serviceProvider', async () => {
            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 'Organization/org-123'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toHaveProperty('Organization');
            expect(extractor.nestedResourceReferences['Organization'].has('org-123')).toBe(true);
        });

        test('should extract multiple non-clinical references from a single resource', async () => {
            const resource = {
                resourceType: 'Encounter',
                participant: [
                    {
                        individual: {
                            _uuid: 'Practitioner/pract-uuid-1',
                            _sourceId: 'Practitioner/pract-source-1'
                        }
                    },
                    {
                        individual: {
                            _uuid: 'Location/loc-uuid-1',
                            _sourceId: 'Location/loc-source-1'
                        }
                    }
                ],
                serviceProvider: {
                    _uuid: 'Organization/org-456'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toHaveProperty('Organization');
            expect(extractor.nestedResourceReferences['Organization'].has('org-456')).toBe(true);
            // Practitioner comes from _sourceId path
            expect(extractor.nestedResourceReferences).toHaveProperty('Practitioner');
            expect(extractor.nestedResourceReferences['Practitioner'].has('pract-source-1')).toBe(true);
        });

        test('should accumulate references across multiple processResource calls', async () => {
            const resource1 = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 'Organization/org-1'
                }
            };
            const resource2 = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 'Organization/org-2'
                }
            };

            await extractor.processResource(resource1);
            await extractor.processResource(resource2);

            expect(extractor.nestedResourceReferences['Organization'].size).toBe(2);
            expect(extractor.nestedResourceReferences['Organization'].has('org-1')).toBe(true);
            expect(extractor.nestedResourceReferences['Organization'].has('org-2')).toBe(true);
        });
    });

    describe('Filtering by resourcesTypeToExclude', () => {
        test('should not extract references for excluded resource types', async () => {
            extractor = new NonClinicalReferencesExtractor({
                resourcesTypeToExclude: ['Organization'],
                resourcePool: null
            });

            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 'Organization/org-123'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).not.toHaveProperty('Organization');
        });

        test('should still extract non-excluded types when some are excluded', async () => {
            extractor = new NonClinicalReferencesExtractor({
                resourcesTypeToExclude: ['Organization'],
                resourcePool: null
            });

            const resource = {
                resourceType: 'Encounter',
                participant: [
                    { individual: { _uuid: 'Location/loc-1' } }
                ],
                serviceProvider: {
                    _uuid: 'Organization/org-123'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).not.toHaveProperty('Organization');
            expect(extractor.nestedResourceReferences).toHaveProperty('Location');
            expect(extractor.nestedResourceReferences['Location'].has('loc-1')).toBe(true);
        });
    });

    describe('Filtering by resourcePool', () => {
        test('should only include resource types present in resourcePool', async () => {
            extractor = new NonClinicalReferencesExtractor({
                resourcesTypeToExclude: [],
                resourcePool: ['Organization']
            });

            const resource = {
                resourceType: 'Encounter',
                participant: [
                    { individual: { _uuid: 'Location/loc-1' } }
                ],
                serviceProvider: {
                    _uuid: 'Organization/org-123'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toHaveProperty('Organization');
            expect(extractor.nestedResourceReferences).not.toHaveProperty('Location');
        });

        test('should accept resourcePool as a Set', async () => {
            extractor = new NonClinicalReferencesExtractor({
                resourcesTypeToExclude: [],
                resourcePool: new Set(['Organization'])
            });

            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 'Organization/org-123'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toHaveProperty('Organization');
        });

        test('resourcesTypeToExclude takes precedence over resourcePool', async () => {
            extractor = new NonClinicalReferencesExtractor({
                resourcesTypeToExclude: ['Organization'],
                resourcePool: ['Organization', 'Location']
            });

            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 'Organization/org-123'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).not.toHaveProperty('Organization');
        });
    });

    describe('CRITICAL: Tampered NonClinicalDataFields JSON could leak cross-tenant data', () => {
        test('should only extract references that belong to nonClinicalResources set', async () => {
            // Even if the field paths JSON points to a clinical resource type reference,
            // the extractor should NOT include it because it checks nonClinicaResourcesSet
            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    // Patient is NOT in nonClinicalResources set - should be filtered out
                    _uuid: 'Patient/patient-from-other-tenant'
                }
            };

            await extractor.processResource(resource);

            // Patient is a clinical resource, so it must NOT appear in nestedResourceReferences
            expect(extractor.nestedResourceReferences).not.toHaveProperty('Patient');
        });

        test('should not extract references for resource types not in nonClinicalResources', async () => {
            const resource = {
                resourceType: 'Observation',
                performer: {
                    // Encounter is NOT in our mocked nonClinicalResources
                    _uuid: 'Encounter/enc-cross-tenant'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).not.toHaveProperty('Encounter');
        });
    });

    describe('CRITICAL: DocumentReference Binary URL extraction with _sourceAssigningAuthority', () => {
        test('should extract Binary references from content.attachment.url', async () => {
            const resource = {
                resourceType: 'DocumentReference',
                subject: { _uuid: 'Patient/pat-1' },
                author: [{ _uuid: 'Organization/org-1' }],
                content: [
                    {
                        attachment: {
                            url: 'Binary/some-binary-id'
                        }
                    }
                ],
                _sourceAssigningAuthority: 'tenant-a'
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toHaveProperty('Binary');
        });

        test('should generate UUID using _sourceAssigningAuthority for non-uuid Binary ids', async () => {
            const resource = {
                resourceType: 'DocumentReference',
                content: [
                    {
                        attachment: {
                            url: 'Binary/non-uuid-id'
                        }
                    }
                ],
                _sourceAssigningAuthority: 'tenant-a'
            };

            await extractor.processResource(resource);

            // The generated UUID should incorporate _sourceAssigningAuthority
            expect(extractor.nestedResourceReferences).toHaveProperty('Binary');
            const binaryIds = Array.from(extractor.nestedResourceReferences['Binary']);
            // The id stored is the generated UUID (which is deterministic based on 'non-uuid-id|tenant-a')
            // It should be a UUID-format string (since generateUUIDv5 produces one)
            expect(binaryIds[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });

        test('SECURITY: different _sourceAssigningAuthority produces different Binary UUIDs', async () => {
            // The UUID is generated from `${id}|${_sourceAssigningAuthority}`.
            // Different tenants MUST produce different UUIDs for the same Binary source id.
            const resourceCorrectTenant = {
                resourceType: 'DocumentReference',
                content: [{ attachment: { url: 'Binary/doc-binary-1' } }],
                _sourceAssigningAuthority: 'correct-tenant'
            };

            const resourceWrongTenant = {
                resourceType: 'DocumentReference',
                content: [{ attachment: { url: 'Binary/doc-binary-1' } }],
                _sourceAssigningAuthority: 'wrong-tenant'
            };

            const extractor1 = new NonClinicalReferencesExtractor({
                resourcesTypeToExclude: [],
                resourcePool: null
            });
            const extractor2 = new NonClinicalReferencesExtractor({
                resourcesTypeToExclude: [],
                resourcePool: null
            });

            await extractor1.processResource(resourceCorrectTenant);
            await extractor2.processResource(resourceWrongTenant);

            const ids1 = Array.from(extractor1.nestedResourceReferences['Binary']);
            const ids2 = Array.from(extractor2.nestedResourceReferences['Binary']);

            // Different _sourceAssigningAuthority MUST produce different Binary UUIDs
            // If they were the same, one tenant could access another's Binary
            expect(ids1[0]).not.toBe(ids2[0]);
        });

        test('should keep existing UUID Binary references unchanged', async () => {
            const existingUuid = '12345678-1234-1234-1234-123456789abc';
            const resource = {
                resourceType: 'DocumentReference',
                content: [
                    {
                        attachment: {
                            url: `Binary/${existingUuid}`
                        }
                    }
                ],
                _sourceAssigningAuthority: 'tenant-a'
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toHaveProperty('Binary');
            const binaryIds = Array.from(extractor.nestedResourceReferences['Binary']);
            expect(binaryIds[0]).toBe(existingUuid);
        });

        test('should only extract Binary references from DocumentReference content.attachment.url, not other types', async () => {
            const resource = {
                resourceType: 'DocumentReference',
                content: [
                    {
                        attachment: {
                            // This is Organization, not Binary -- should be filtered out
                            url: 'Organization/org-in-url'
                        }
                    }
                ],
                _sourceAssigningAuthority: 'tenant-a'
            };

            await extractor.processResource(resource);

            // Organization should NOT be extracted from this path because the
            // DocumentReference special handling only keeps Binary references
            expect(extractor.nestedResourceReferences['Organization']).toBeUndefined();
        });
    });

    describe('BUG: Practitioner _sourceId special handling with cross-tenant references', () => {
        test('should read Practitioner references from _sourceId path variant', async () => {
            const resource = {
                resourceType: 'Encounter',
                participant: [
                    {
                        individual: {
                            _uuid: 'Practitioner/pract-uuid-1',
                            _sourceId: 'Practitioner/pract-source-1'
                        }
                    }
                ]
            };

            await extractor.processResource(resource);

            // Practitioner should be extracted via _sourceId path
            expect(extractor.nestedResourceReferences).toHaveProperty('Practitioner');
            expect(extractor.nestedResourceReferences['Practitioner'].has('pract-source-1')).toBe(true);
        });

        test('should replace _uuid Practitioner references with _sourceId references', async () => {
            const resource = {
                resourceType: 'Encounter',
                participant: [
                    {
                        individual: {
                            _uuid: 'Practitioner/pract-uuid-1',
                            _sourceId: 'Practitioner/pract-source-1'
                        }
                    }
                ]
            };

            await extractor.processResource(resource);

            // The _uuid version should NOT be kept -- only _sourceId version
            const practIds = Array.from(extractor.nestedResourceReferences['Practitioner']);
            expect(practIds).toContain('pract-source-1');
            expect(practIds).not.toContain('pract-uuid-1');
        });

        test('SECURITY: _sourceId containing cross-tenant Practitioner reference is followed without tenant validation', async () => {
            // This tests that _sourceId references are followed directly.
            // If _sourceId contains a cross-tenant reference, the extractor will include it.
            const resource = {
                resourceType: 'Encounter',
                participant: [
                    {
                        individual: {
                            _uuid: 'Practitioner/local-uuid',
                            _sourceId: 'Practitioner/cross-tenant-pract-id'
                        }
                    }
                ]
            };

            await extractor.processResource(resource);

            // The extractor follows _sourceId without any tenant validation
            // This is a security concern - it extracts whatever is in _sourceId
            expect(extractor.nestedResourceReferences['Practitioner'].has('cross-tenant-pract-id')).toBe(true);
        });
    });

    describe('BUG: Non-array, non-null values from getNestedProperty', () => {
        test('should handle non-array value by wrapping in array', async () => {
            // When getNestedProperty returns a single string (not in array),
            // the code wraps it: references = [references]
            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 'Organization/org-single'
                }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toHaveProperty('Organization');
            expect(extractor.nestedResourceReferences['Organization'].has('org-single')).toBe(true);
        });

        test('should handle numeric value from malformed resource without crashing on split', async () => {
            // If a field contains a number instead of a reference string,
            // the code wraps it in an array and calls split('/') on it
            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: 12345 // numeric, not a string
                }
            };

            // This should either handle gracefully or throw
            // The bug is that split('/') on a number would throw TypeError
            await expect(extractor.processResource(resource)).rejects.toThrow();
        });

        test('should handle boolean value from malformed resource without crashing', async () => {
            const resource = {
                resourceType: 'Encounter',
                serviceProvider: {
                    _uuid: true // boolean, not a string
                }
            };

            // ReferenceParser.parseReference expects a string - boolean will cause issues
            // The bug is lack of type checking before calling split
            await expect(extractor.processResource(resource)).rejects.toThrow();
        });
    });

    describe('Edge cases', () => {
        test('should handle resource with no matching fields in NonClinicalDataFields', async () => {
            const resource = {
                resourceType: 'UnknownResourceType',
                someField: 'Organization/org-1'
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toEqual({});
        });

        test('should handle resource where nested path returns undefined', async () => {
            const resource = {
                resourceType: 'Encounter'
                // No participant or serviceProvider fields
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toEqual({});
        });

        test('should handle empty array from nested property', async () => {
            const resource = {
                resourceType: 'Encounter',
                participant: []
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).toEqual({});
        });
    });
});
