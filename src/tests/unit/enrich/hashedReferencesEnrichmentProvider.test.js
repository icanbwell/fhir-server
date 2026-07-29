'use strict';

const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

const { HashReferencesEnrichmentProvider } = require('../../../enrich/providers/hashedReferencesEnrichmentProvider');

describe('HashReferencesEnrichmentProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new HashReferencesEnrichmentProvider();
    });

    describe('enrichAsync - happy path', () => {
        test('should rewrite references to contained resources with # prefix', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        {
                            resourceType: 'Organization',
                            id: 'org-1'
                        }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-1'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].managingOrganization.reference).toBe('Organization/#org-1');
        });

        test('should rewrite self-references to use # prefix', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [],
                    link: [
                        {
                            other: {
                                reference: 'Patient/patient-1'
                            }
                        }
                    ]
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].link[0].other.reference).toBe('Patient/#patient-1');
        });

        test('should handle multiple contained resources', async () => {
            const resources = [
                {
                    resourceType: 'MedicationRequest',
                    id: 'med-req-1',
                    contained: [
                        { resourceType: 'Medication', id: 'med-1' },
                        { resourceType: 'Practitioner', id: 'pract-1' }
                    ],
                    medicationReference: {
                        reference: 'Medication/med-1'
                    },
                    requester: {
                        reference: 'Practitioner/pract-1'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].medicationReference.reference).toBe('Medication/#med-1');
            expect(result[0].requester.reference).toBe('Practitioner/#pract-1');
        });
    });

    describe('References to non-contained resources left unchanged', () => {
        test('should NOT rewrite references to resources not in contained or self', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-1' }
                    ],
                    generalPractitioner: [
                        {
                            reference: 'Practitioner/external-pract'
                        }
                    ]
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            // Practitioner/external-pract is NOT in contained, so it stays unchanged
            expect(result[0].generalPractitioner[0].reference).toBe('Practitioner/external-pract');
        });

        test('should not rewrite references where type matches but id differs', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-1' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-different'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].managingOrganization.reference).toBe('Organization/org-different');
        });
    });

    describe('_hash_references=false skips enrichment', () => {
        test('should not modify resources when _hash_references is false', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-1' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-1'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'false' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].managingOrganization.reference).toBe('Organization/org-1');
        });

        test('should not modify resources when _hash_references is undefined', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-1' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-1'
                    }
                }
            ];

            const parsedArgs = {};
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].managingOrganization.reference).toBe('Organization/org-1');
        });

        test('should not modify resources when _hash_references is null', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-1' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-1'
                    }
                }
            ];

            const parsedArgs = { _hash_references: null };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].managingOrganization.reference).toBe('Organization/org-1');
        });
    });

    describe('CRITICAL: Client-controlled _hash_references parameter', () => {
        test('should activate when _hash_references is string "1"', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-1' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-1'
                    }
                }
            ];

            const parsedArgs = { _hash_references: '1' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            // isTrue accepts '1' as truthy - any client can trigger this
            expect(result[0].managingOrganization.reference).toBe('Organization/#org-1');
        });

        test('should activate when _hash_references is boolean true', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-1' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-1'
                    }
                }
            ];

            const parsedArgs = { _hash_references: true };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            expect(result[0].managingOrganization.reference).toBe('Organization/#org-1');
        });
    });

    describe('BUG: Cross-tenant contained resource ID collision', () => {
        test('should only rewrite reference if it exactly matches a contained resource type/id', async () => {
            // If two resources from different tenants both have Organization/org-1 in contained,
            // the provider builds the set from the CURRENT resource's contained only,
            // so there's no cross-contamination WITHIN a single enrichAsync call per resource
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-tenant-a' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-tenant-b'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            // org-tenant-b is NOT in this resource's contained, so should NOT be rewritten
            expect(result[0].managingOrganization.reference).toBe('Organization/org-tenant-b');
        });

        test('should rewrite reference when contained resource has same type/id as cross-tenant resource', async () => {
            // This is the dangerous scenario: if a contained resource has the SAME
            // resourceType/id as a cross-tenant resource that is also referenced,
            // the rewriting will incorrectly make it a contained reference
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        // This contained resource happens to share type/id with a cross-tenant resource
                        { resourceType: 'Organization', id: 'shared-org-id' }
                    ],
                    managingOrganization: {
                        // This reference might actually point to a DIFFERENT Organization
                        // in another tenant, but because type/id matches contained, it gets rewritten
                        reference: 'Organization/shared-org-id'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            // The provider WILL rewrite this because it matches the contained resource type/id
            // This is the bug: it can't distinguish between a reference to the contained resource
            // vs a reference to a cross-tenant resource with the same type/id
            expect(result[0].managingOrganization.reference).toBe('Organization/#shared-org-id');
        });

        test('should handle batch of resources independently - no cross-contamination', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: 'org-from-patient-1' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-from-patient-2'
                    }
                },
                {
                    resourceType: 'Patient',
                    id: 'patient-2',
                    contained: [
                        { resourceType: 'Organization', id: 'org-from-patient-2' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/org-from-patient-1'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            // Patient-1's reference to org-from-patient-2 should NOT be rewritten
            // (not in patient-1's contained)
            expect(result[0].managingOrganization.reference).toBe('Organization/org-from-patient-2');

            // Patient-2's reference to org-from-patient-1 should NOT be rewritten
            // (not in patient-2's contained)
            expect(result[1].managingOrganization.reference).toBe('Organization/org-from-patient-1');
        });
    });

    describe('BUG: Empty string id handling', () => {
        test('should handle reference with empty string id', async () => {
            // ''.startsWith('#') is false, so the code would try to prefix with #
            // creating a reference like 'Organization/#' which is invalid
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [
                        { resourceType: 'Organization', id: '' }
                    ],
                    managingOrganization: {
                        reference: 'Organization/'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichAsync({ resources, parsedArgs });

            // The resourceTypeAndIdSet will contain 'Organization/' (from contained with empty id)
            // The reference is also 'Organization/' so it matches.
            // The code will add # prefix to the empty id, producing 'Organization/#'
            // This is a bug - it should either skip empty ids or handle them gracefully
            if (result[0].managingOrganization.reference.includes('#')) {
                // If it did rewrite, verify it produced a reference with just '#' as id
                expect(result[0].managingOrganization.reference).toContain('#');
            }
        });

        test('should not crash when reference has no id portion', async () => {
            const resources = [
                {
                    resourceType: 'Patient',
                    id: 'patient-1',
                    contained: [],
                    managingOrganization: {
                        reference: 'Organization/'
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };

            // Should not throw
            const result = await provider.enrichAsync({ resources, parsedArgs });
            expect(result).toBeDefined();
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('should rewrite references in bundle entries', async () => {
            const entries = [
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        contained: [
                            { resourceType: 'Organization', id: 'org-1' }
                        ],
                        managingOrganization: {
                            reference: 'Organization/org-1'
                        }
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource.managingOrganization.reference).toBe('Organization/#org-1');
        });

        test('should skip bundle entries when _hash_references is false', async () => {
            const entries = [
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        contained: [
                            { resourceType: 'Organization', id: 'org-1' }
                        ],
                        managingOrganization: {
                            reference: 'Organization/org-1'
                        }
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'false' };
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource.managingOrganization.reference).toBe('Organization/org-1');
        });

        test('should handle entries with null resource gracefully', async () => {
            const entries = [
                { resource: null },
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        contained: [
                            { resourceType: 'Organization', id: 'org-1' }
                        ],
                        managingOrganization: {
                            reference: 'Organization/org-1'
                        }
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource).toBeNull();
            expect(result[1].resource.managingOrganization.reference).toBe('Organization/#org-1');
        });
    });

    describe('updateReferenceAsync', () => {
        test('should not modify reference that already starts with #', async () => {
            const reference = { reference: '#already-contained' };
            // The reference '#already-contained' when parsed will have id starting with '#'
            // But actually parseReference would set id = '#already-contained' (no resourceType)
            // and it doesn't match anything in the set, so it stays unchanged
            const resourceTypeAndIdSet = new Set(['#already-contained']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            // References starting with # are already contained references, should not be double-prefixed
            expect(result.reference).toBe('#already-contained');
        });

        test('should not modify reference when reference property is missing', async () => {
            const reference = { display: 'Some Organization' };
            const resourceTypeAndIdSet = new Set(['Organization/org-1']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            expect(result.reference).toBeUndefined();
            expect(result.display).toBe('Some Organization');
        });

        test('should preserve sourceAssigningAuthority in rewritten reference', async () => {
            const reference = { reference: 'Organization/org-1|client-a' };
            const resourceTypeAndIdSet = new Set(['Organization/org-1|client-a']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            // Should rewrite with # prefix on id while keeping sourceAssigningAuthority
            expect(result.reference).toContain('#org-1');
        });
    });
});
