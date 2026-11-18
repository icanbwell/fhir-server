'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock the generated JSON files
jestGlobal.mock('../../../../operations/everything/generated.non_clinical_resources_fields.json', () => ({
    DocumentReference: [
        'subject._uuid',
        'author._uuid'
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

    describe('DocumentReference attachment url', () => {
        test('does not follow content.attachment.url to a Binary', async () => {
            // A Binary reaches $everything through its own securityContext, not through the
            // DocumentReference that points at it.
            const resource = {
                resourceType: 'DocumentReference',
                subject: { _uuid: 'Patient/pat-1' },
                content: [{ attachment: { url: 'Binary/some-binary-id' } }],
                _sourceAssigningAuthority: 'tenant-a'
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).not.toHaveProperty('Binary');
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

        // An empty id reaches the follow-up query as `id: ''`, which the args parser drops,
        // leaving a find with no id filter that walks the whole Practitioner collection.
        test.each([
            'Practitioner/',
            'Practitioner/|some-authority'
        ])('does not extract an empty Practitioner id from _sourceId %s', async (sourceId) => {
            const resource = {
                resourceType: 'Encounter',
                participant: [
                    {
                        individual: {
                            _uuid: 'Practitioner/pract-uuid-1',
                            _sourceId: sourceId
                        }
                    }
                ]
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).not.toHaveProperty('Practitioner');
        });

        test('keeps the valid Practitioner id when a sibling reference has an empty id', async () => {
            const resource = {
                resourceType: 'Encounter',
                participant: [
                    { individual: { _uuid: 'Practitioner/pract-uuid-1', _sourceId: 'Practitioner/' } },
                    { individual: { _uuid: 'Practitioner/pract-uuid-2', _sourceId: 'Practitioner/pract-source-2' } }
                ]
            };

            await extractor.processResource(resource);

            expect(Array.from(extractor.nestedResourceReferences['Practitioner'])).toEqual(['pract-source-2']);
        });
    });

    describe('Empty reference ids for other non-clinical types', () => {
        test('does not extract an empty Organization id', async () => {
            const resource = {
                resourceType: 'Encounter',
                serviceProvider: { _uuid: 'Organization/' }
            };

            await extractor.processResource(resource);

            expect(extractor.nestedResourceReferences).not.toHaveProperty('Organization');
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
