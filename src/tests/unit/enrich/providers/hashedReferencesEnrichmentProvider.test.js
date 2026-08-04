'use strict';

const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

const { HashReferencesEnrichmentProvider } = require('../../../../enrich/providers/hashedReferencesEnrichmentProvider');

describe('HashReferencesEnrichmentProvider', () => {
    let provider;

    beforeEach(() => {
        provider = new HashReferencesEnrichmentProvider();
    });

    describe('enrichAsync', () => {
        describe('happy path - references to contained resources rewritten', () => {
            test('rewrites reference to contained resource with # prefix', async () => {
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

                const parsedArgs = { _hash_references: 'true' };
                const result = await provider.enrichAsync({ resources, parsedArgs });

                expect(result[0].managingOrganization.reference).toBe('Organization/#org-1');
            });

            test('rewrites self-references to use # prefix', async () => {
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

            test('handles multiple contained resources', async () => {
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

            test('handles resource with no contained array', async () => {
                const resources = [
                    {
                        resourceType: 'Patient',
                        id: 'patient-1',
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

                // Self-reference should still be rewritten even without contained array
                expect(result[0].link[0].other.reference).toBe('Patient/#patient-1');
            });

            test('handles empty contained array', async () => {
                const resources = [
                    {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        contained: [],
                        managingOrganization: {
                            reference: 'Organization/external-org'
                        }
                    }
                ];

                const parsedArgs = { _hash_references: 'true' };
                const result = await provider.enrichAsync({ resources, parsedArgs });

                // External reference not in contained set, stays unchanged
                expect(result[0].managingOrganization.reference).toBe('Organization/external-org');
            });
        });

        describe('references to non-contained resources left unchanged', () => {
            test('does not rewrite references to external resources', async () => {
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

                expect(result[0].generalPractitioner[0].reference).toBe('Practitioner/external-pract');
            });

            test('does not rewrite reference when type matches but id differs', async () => {
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

        describe('_hash_references flag variations', () => {
            test('does not modify resources when _hash_references is false', async () => {
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

            test('does not modify resources when _hash_references is undefined', async () => {
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

            test('does not modify resources when _hash_references is null', async () => {
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

            test('activates when _hash_references is string "1"', async () => {
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

                expect(result[0].managingOrganization.reference).toBe('Organization/#org-1');
            });

            test('activates when _hash_references is boolean true', async () => {
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

        describe('multiple resources processed independently', () => {
            test('builds separate resourceTypeAndIdSet per resource - no cross-contamination', async () => {
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

                // Each resource should only rewrite references to its own contained resources
                expect(result[0].managingOrganization.reference).toBe('Organization/org-from-patient-2');
                expect(result[1].managingOrganization.reference).toBe('Organization/org-from-patient-1');
            });

            test('handles null resource in array gracefully', async () => {
                const resources = [
                    null,
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

                const parsedArgs = { _hash_references: 'true' };
                const result = await provider.enrichAsync({ resources, parsedArgs });

                expect(result[0]).toBeNull();
                expect(result[1].managingOrganization.reference).toBe('Organization/#org-1');
            });

            test('handles empty resources array', async () => {
                const resources = [];
                const parsedArgs = { _hash_references: 'true' };
                const result = await provider.enrichAsync({ resources, parsedArgs });
                expect(result).toEqual([]);
            });
        });

        describe('deeply nested references', () => {
            test('rewrites references nested in arrays', async () => {
                const resources = [
                    {
                        resourceType: 'Encounter',
                        id: 'enc-1',
                        contained: [
                            { resourceType: 'Practitioner', id: 'pract-1' },
                            { resourceType: 'Practitioner', id: 'pract-2' }
                        ],
                        participant: [
                            {
                                individual: {
                                    reference: 'Practitioner/pract-1'
                                }
                            },
                            {
                                individual: {
                                    reference: 'Practitioner/pract-2'
                                }
                            }
                        ]
                    }
                ];

                const parsedArgs = { _hash_references: 'true' };
                const result = await provider.enrichAsync({ resources, parsedArgs });

                expect(result[0].participant[0].individual.reference).toBe('Practitioner/#pract-1');
                expect(result[0].participant[1].individual.reference).toBe('Practitioner/#pract-2');
            });
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('rewrites references in bundle entries', async () => {
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

        test('skips bundle entries when _hash_references is false', async () => {
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

        test('handles entries with null resource gracefully', async () => {
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

        test('handles multiple entries independently', async () => {
            const entries = [
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-1',
                        contained: [
                            { resourceType: 'Organization', id: 'org-a' }
                        ],
                        managingOrganization: { reference: 'Organization/org-a' }
                    }
                },
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'patient-2',
                        contained: [
                            { resourceType: 'Organization', id: 'org-b' }
                        ],
                        managingOrganization: { reference: 'Organization/org-a' }
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            // Entry 1: org-a is in its contained, so gets rewritten
            expect(result[0].resource.managingOrganization.reference).toBe('Organization/#org-a');
            // Entry 2: org-a is NOT in its contained (only org-b is), so stays unchanged
            expect(result[1].resource.managingOrganization.reference).toBe('Organization/org-a');
        });

        test('handles entry with resource having no contained', async () => {
            const entries = [
                {
                    resource: {
                        resourceType: 'Observation',
                        id: 'obs-1',
                        subject: {
                            reference: 'Patient/patient-1'
                        }
                    }
                }
            ];

            const parsedArgs = { _hash_references: 'true' };
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            // Reference not in contained set, stays unchanged
            expect(result[0].resource.subject.reference).toBe('Patient/patient-1');
        });

        test('returns entries as-is when _hash_references is undefined', async () => {
            const entries = [
                {
                    resource: {
                        resourceType: 'Patient',
                        id: 'p-1',
                        contained: [{ resourceType: 'Organization', id: 'o-1' }],
                        managingOrganization: { reference: 'Organization/o-1' }
                    }
                }
            ];

            const parsedArgs = {};
            const result = await provider.enrichBundleEntriesAsync({ entries, parsedArgs });

            expect(result[0].resource.managingOrganization.reference).toBe('Organization/o-1');
        });
    });

    describe('updateReferenceAsync', () => {
        test('rewrites reference when it matches a resource in the set', async () => {
            const reference = { reference: 'Organization/org-1' };
            const resourceTypeAndIdSet = new Set(['Organization/org-1']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            expect(result.reference).toBe('Organization/#org-1');
        });

        test('does not modify reference when not in the set', async () => {
            const reference = { reference: 'Organization/external' };
            const resourceTypeAndIdSet = new Set(['Organization/org-1']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            expect(result.reference).toBe('Organization/external');
        });

        test('does not modify reference that already starts with #', async () => {
            // A reference like '#already-contained' has no resourceType in parsed form
            // and its id starts with # - the guard `!id.startsWith('#')` prevents double-hashing
            const reference = { reference: 'Patient/#already-hashed' };
            const resourceTypeAndIdSet = new Set(['Patient/#already-hashed']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            // id is '#already-hashed' which starts with '#', so no rewriting occurs
            expect(result.reference).toBe('Patient/#already-hashed');
        });

        test('does not modify reference when reference property is missing', async () => {
            const reference = { display: 'Some Organization' };
            const resourceTypeAndIdSet = new Set(['Organization/org-1']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            expect(result.reference).toBeUndefined();
            expect(result.display).toBe('Some Organization');
        });

        test('preserves sourceAssigningAuthority in rewritten reference', async () => {
            const reference = { reference: 'Organization/org-1|client-a' };
            const resourceTypeAndIdSet = new Set(['Organization/org-1|client-a']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            // After rewrite, should contain # prefix on id with sourceAssigningAuthority
            expect(result.reference).toContain('#org-1');
            expect(result.reference).toContain('|client-a');
        });

        test('does not rewrite reference when reference.reference is empty string', async () => {
            const reference = { reference: '' };
            const resourceTypeAndIdSet = new Set(['Patient/patient-1']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            // Empty string is falsy, so the if (reference.reference) guard skips it
            expect(result.reference).toBe('');
        });

        test('handles reference with resourceType only (no id after slash)', async () => {
            const reference = { reference: 'Organization/' };
            const resourceTypeAndIdSet = new Set(['Organization/']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            // id is '' which does not start with '#', and the reference is in the set
            // So it will get rewritten with # prefix on empty id
            expect(result.reference).toContain('#');
        });

        test('returns same reference object (mutates in place)', async () => {
            const reference = { reference: 'Patient/p-1', display: 'Test' };
            const resourceTypeAndIdSet = new Set(['Patient/p-1']);

            const result = await provider.updateReferenceAsync({ reference, resourceTypeAndIdSet });

            expect(result).toBe(reference); // Same object reference
            expect(result.display).toBe('Test'); // Other properties preserved
        });
    });
});
