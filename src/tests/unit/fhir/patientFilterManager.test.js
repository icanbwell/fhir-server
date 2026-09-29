'use strict';

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');

describe('PatientFilterManager', () => {
    /**
     * @type {PatientFilterManager}
     */
    let manager;

    beforeEach(() => {
        manager = new PatientFilterManager();
    });

    describe('patientFilterMapping', () => {
        test('contains expected core resource types', () => {
            const mapping = manager.patientFilterMapping;
            expect(mapping).toHaveProperty('Patient');
            expect(mapping).toHaveProperty('Observation');
            expect(mapping).toHaveProperty('Condition');
            expect(mapping).toHaveProperty('Encounter');
            expect(mapping).toHaveProperty('MedicationRequest');
            expect(mapping).toHaveProperty('AllergyIntolerance');
            expect(mapping).toHaveProperty('Immunization');
            expect(mapping).toHaveProperty('Procedure');
            expect(mapping).toHaveProperty('DiagnosticReport');
            expect(mapping).toHaveProperty('CarePlan');
        });

        test('maps Patient to id field', () => {
            expect(manager.patientFilterMapping.Patient).toBe('id');
        });

        test('maps Observation to subject.reference', () => {
            expect(manager.patientFilterMapping.Observation).toBe('subject.reference');
        });

        test('maps AllergyIntolerance to patient.reference', () => {
            expect(manager.patientFilterMapping.AllergyIntolerance).toBe('patient.reference');
        });

        test('maps Coverage to beneficiary.reference', () => {
            expect(manager.patientFilterMapping.Coverage).toBe('beneficiary.reference');
        });

        test('maps Task to for.reference', () => {
            expect(manager.patientFilterMapping.Task).toBe('for.reference');
        });

        test('maps EnrollmentRequest to candidate.reference', () => {
            expect(manager.patientFilterMapping.EnrollmentRequest).toBe('candidate.reference');
        });

        test('maps ResearchSubject to individual.reference', () => {
            expect(manager.patientFilterMapping.ResearchSubject).toBe('individual.reference');
        });

        test('maps Group to member.entity.reference', () => {
            expect(manager.patientFilterMapping.Group).toBe('member.entity.reference');
        });

        test('does NOT contain non-patient resources', () => {
            const mapping = manager.patientFilterMapping;
            expect(mapping).not.toHaveProperty('Practitioner');
            expect(mapping).not.toHaveProperty('Organization');
            expect(mapping).not.toHaveProperty('StructureDefinition');
            expect(mapping).not.toHaveProperty('ValueSet');
            expect(mapping).not.toHaveProperty('Medication');
            expect(mapping).not.toHaveProperty('Location');
            expect(mapping).not.toHaveProperty('PractitionerRole');
            expect(mapping).not.toHaveProperty('HealthcareService');
        });

        test('contains at least 70 resource types', () => {
            const count = Object.keys(manager.patientFilterMapping).length;
            expect(count).toBeGreaterThanOrEqual(70);
        });
    });

    describe('personFilterMapping', () => {
        test('maps Person to id', () => {
            expect(manager.personFilterMapping.Person).toBe('id');
        });

        test('contains only Person', () => {
            expect(Object.keys(manager.personFilterMapping)).toEqual(['Person']);
        });
    });

    describe('personFilterWithQueryMapping', () => {
        test('contains Subscription, SubscriptionStatus, and SubscriptionTopic', () => {
            const mapping = manager.personFilterWithQueryMapping;
            expect(mapping).toHaveProperty('Subscription');
            expect(mapping).toHaveProperty('SubscriptionStatus');
            expect(mapping).toHaveProperty('SubscriptionTopic');
        });

        test('Subscription uses extension-based query with {person} placeholder', () => {
            const query = manager.personFilterWithQueryMapping.Subscription;
            expect(query).toContain('extension=');
            expect(query).toContain('{person}');
            expect(query).toBe('extension=https://icanbwell.com/codes/client_person_id|{person}');
        });

        test('SubscriptionStatus uses extension-based query with {person} placeholder', () => {
            const query = manager.personFilterWithQueryMapping.SubscriptionStatus;
            expect(query).toContain('extension=');
            expect(query).toContain('{person}');
            expect(query).toBe('extension=https://icanbwell.com/codes/client_person_id|{person}');
        });

        test('SubscriptionTopic uses identifier-based query (different from Subscription)', () => {
            const query = manager.personFilterWithQueryMapping.SubscriptionTopic;
            expect(query).toContain('identifier=');
            expect(query).toContain('{person}');
            expect(query).toBe('identifier=https://icanbwell.com/codes/client_person_id|{person}');
        });

        test('Subscription and SubscriptionTopic use different field prefixes', () => {
            const subscriptionQuery = manager.personFilterWithQueryMapping.Subscription;
            const topicQuery = manager.personFilterWithQueryMapping.SubscriptionTopic;
            // Subscription uses extension=, SubscriptionTopic uses identifier=
            expect(subscriptionQuery.startsWith('extension=')).toBe(true);
            expect(topicQuery.startsWith('identifier=')).toBe(true);
            expect(subscriptionQuery.startsWith('identifier=')).toBe(false);
            expect(topicQuery.startsWith('extension=')).toBe(false);
        });
    });

    describe('getPatientPropertyForResource', () => {
        test('returns correct field for Observation', () => {
            expect(manager.getPatientPropertyForResource({ resourceType: 'Observation' }))
                .toBe('subject.reference');
        });

        test('returns correct field for Patient', () => {
            expect(manager.getPatientPropertyForResource({ resourceType: 'Patient' }))
                .toBe('id');
        });

        test('returns correct field for AllergyIntolerance', () => {
            expect(manager.getPatientPropertyForResource({ resourceType: 'AllergyIntolerance' }))
                .toBe('patient.reference');
        });

        test('returns undefined for unknown resource type', () => {
            expect(manager.getPatientPropertyForResource({ resourceType: 'FakeResource' }))
                .toBeUndefined();
        });

        test('returns undefined for non-patient resources', () => {
            expect(manager.getPatientPropertyForResource({ resourceType: 'Practitioner' }))
                .toBeUndefined();
            expect(manager.getPatientPropertyForResource({ resourceType: 'Organization' }))
                .toBeUndefined();
            expect(manager.getPatientPropertyForResource({ resourceType: 'Medication' }))
                .toBeUndefined();
        });

        test('does not throw for unknown resource type', () => {
            expect(() => {
                manager.getPatientPropertyForResource({ resourceType: 'NonExistent' });
            }).not.toThrow();
        });
    });

    describe('getPersonPropertyForResource', () => {
        test('returns id for Person', () => {
            expect(manager.getPersonPropertyForResource({ resourceType: 'Person' }))
                .toBe('id');
        });

        test('returns undefined for Patient', () => {
            expect(manager.getPersonPropertyForResource({ resourceType: 'Patient' }))
                .toBeUndefined();
        });

        test('returns undefined for unknown resource type', () => {
            expect(manager.getPersonPropertyForResource({ resourceType: 'FakeResource' }))
                .toBeUndefined();
        });

        test('does not throw for unknown resource type', () => {
            expect(() => {
                manager.getPersonPropertyForResource({ resourceType: 'NonExistent' });
            }).not.toThrow();
        });
    });

    describe('getPersonFilterQueryForResource', () => {
        test('returns query template for Subscription', () => {
            const result = manager.getPersonFilterQueryForResource({ resourceType: 'Subscription' });
            expect(result).toBe('extension=https://icanbwell.com/codes/client_person_id|{person}');
        });

        test('returns query template for SubscriptionStatus', () => {
            const result = manager.getPersonFilterQueryForResource({ resourceType: 'SubscriptionStatus' });
            expect(result).toBe('extension=https://icanbwell.com/codes/client_person_id|{person}');
        });

        test('returns query template for SubscriptionTopic', () => {
            const result = manager.getPersonFilterQueryForResource({ resourceType: 'SubscriptionTopic' });
            expect(result).toBe('identifier=https://icanbwell.com/codes/client_person_id|{person}');
        });

        test('returns undefined for resources not in personFilterWithQueryMapping', () => {
            expect(manager.getPersonFilterQueryForResource({ resourceType: 'Observation' }))
                .toBeUndefined();
            expect(manager.getPersonFilterQueryForResource({ resourceType: 'Patient' }))
                .toBeUndefined();
        });

        test('does not throw for unknown resource type', () => {
            expect(() => {
                manager.getPersonFilterQueryForResource({ resourceType: 'NonExistent' });
            }).not.toThrow();
        });
    });

    describe('getPatientFilterQueryForResource', () => {
        test('returns undefined for standard patient resources (patientFilterWithQueryMapping is empty)', () => {
            expect(manager.getPatientFilterQueryForResource({ resourceType: 'Observation' }))
                .toBeUndefined();
            expect(manager.getPatientFilterQueryForResource({ resourceType: 'Patient' }))
                .toBeUndefined();
        });

        test('does not throw for unknown resource type', () => {
            expect(() => {
                manager.getPatientFilterQueryForResource({ resourceType: 'NonExistent' });
            }).not.toThrow();
        });
    });

    describe('canAccessResourceWithPatientScope - scope bypass protection', () => {
        test('returns true for Patient', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Patient' }))
                .toBe(true);
        });

        test('returns true for Observation', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Observation' }))
                .toBe(true);
        });

        test('returns true for Condition', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Condition' }))
                .toBe(true);
        });

        test('returns true for Person (via personFilterMapping)', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Person' }))
                .toBe(true);
        });

        test('returns true for Subscription (via personFilterWithQueryMapping)', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Subscription' }))
                .toBe(true);
        });

        test('returns true for SubscriptionStatus (via personFilterWithQueryMapping)', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'SubscriptionStatus' }))
                .toBe(true);
        });

        test('returns true for SubscriptionTopic (via personFilterWithQueryMapping)', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'SubscriptionTopic' }))
                .toBe(true);
        });

        // CRITICAL: Scope bypass protection tests
        // If these return true, it means any patient-scoped token can access
        // administrative/non-patient resources which is a security violation
        test('returns false for Practitioner - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Practitioner' }))
                .toBe(false);
        });

        test('returns false for Organization - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Organization' }))
                .toBe(false);
        });

        test('returns false for StructureDefinition - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'StructureDefinition' }))
                .toBe(false);
        });

        test('returns false for ValueSet - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'ValueSet' }))
                .toBe(false);
        });

        test('returns false for Medication - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Medication' }))
                .toBe(false);
        });

        test('returns false for Location - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'Location' }))
                .toBe(false);
        });

        test('returns false for PractitionerRole - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'PractitionerRole' }))
                .toBe(false);
        });

        test('returns false for HealthcareService - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'HealthcareService' }))
                .toBe(false);
        });

        test('returns false for CodeSystem - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'CodeSystem' }))
                .toBe(false);
        });

        test('returns false for OperationDefinition - scope bypass protection', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'OperationDefinition' }))
                .toBe(false);
        });

        test('returns false for completely unknown resource type', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: 'NonExistentResource' }))
                .toBe(false);
        });

        test('returns false for empty string resource type', () => {
            expect(manager.canAccessResourceWithPatientScope({ resourceType: '' }))
                .toBe(false);
        });
    });

    describe('isPatientRelatedResource', () => {
        test('returns true for Patient', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'Patient' }))
                .toBe(true);
        });

        test('returns true for Observation', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'Observation' }))
                .toBe(true);
        });

        test('returns true for Person', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'Person' }))
                .toBe(true);
        });

        test('returns true for Subscription (via personFilterWithQueryMapping)', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'Subscription' }))
                .toBe(true);
        });

        test('returns true for SubscriptionTopic (via personFilterWithQueryMapping)', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'SubscriptionTopic' }))
                .toBe(true);
        });

        test('returns false for Practitioner', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'Practitioner' }))
                .toBe(false);
        });

        test('returns false for Organization', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'Organization' }))
                .toBe(false);
        });

        test('returns false for unknown resource type', () => {
            expect(manager.isPatientRelatedResource({ resourceType: 'FakeResource' }))
                .toBe(false);
        });

        test('is consistent with canAccessResourceWithPatientScope', () => {
            // These two methods should agree on which resources are patient-related
            const testResources = [
                'Patient', 'Observation', 'Person', 'Subscription',
                'Practitioner', 'Organization', 'FakeResource'
            ];
            for (const resourceType of testResources) {
                expect(manager.isPatientRelatedResource({ resourceType }))
                    .toBe(manager.canAccessResourceWithPatientScope({ resourceType }));
            }
        });
    });

    describe('getAllPatientOrPersonRelatedResources', () => {
        test('returns an array', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            expect(Array.isArray(result)).toBe(true);
        });

        test('includes Patient', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            expect(result).toContain('Patient');
        });

        test('includes Person', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            expect(result).toContain('Person');
        });

        test('includes Subscription', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            expect(result).toContain('Subscription');
        });

        test('includes SubscriptionStatus', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            expect(result).toContain('SubscriptionStatus');
        });

        test('includes SubscriptionTopic', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            expect(result).toContain('SubscriptionTopic');
        });

        test('does NOT include non-patient resources', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            expect(result).not.toContain('Practitioner');
            expect(result).not.toContain('Organization');
            expect(result).not.toContain('StructureDefinition');
            expect(result).not.toContain('ValueSet');
            expect(result).not.toContain('Medication');
        });

        test('contains all resources from patientFilterMapping', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            const patientResources = Object.keys(manager.patientFilterMapping);
            for (const resource of patientResources) {
                expect(result).toContain(resource);
            }
        });

        test('contains all resources from personFilterMapping', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            const personResources = Object.keys(manager.personFilterMapping);
            for (const resource of personResources) {
                expect(result).toContain(resource);
            }
        });

        test('contains all resources from personFilterWithQueryMapping', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            const queryResources = Object.keys(manager.personFilterWithQueryMapping);
            for (const resource of queryResources) {
                expect(result).toContain(resource);
            }
        });

        test('should not contain duplicates if a resource appears in multiple mappings', () => {
            // This tests a potential bug: if a resource is in both patientFilterMapping
            // and another mapping, it would appear twice in the result.
            // Currently no resource is in multiple mappings, but this guards against
            // future additions that could create duplicates.
            const result = manager.getAllPatientOrPersonRelatedResources();
            const uniqueResult = [...new Set(result)];
            expect(result.length).toBe(uniqueResult.length);
        });

        test('total count matches sum of all mappings', () => {
            const result = manager.getAllPatientOrPersonRelatedResources();
            const expectedCount =
                Object.keys(manager.patientFilterMapping).length +
                Object.keys(manager.patientFilterWithQueryMapping).length +
                Object.keys(manager.personFilterMapping).length +
                Object.keys(manager.personFilterWithQueryMapping).length;
            expect(result.length).toBe(expectedCount);
        });
    });

    describe('getPatientPropertyForPersonScopedResource', () => {
        test('returns link.target.reference for Person', () => {
            expect(manager.getPatientPropertyForPersonScopedResource({ resourceType: 'Person' }))
                .toBe('link.target.reference');
        });

        test('returns undefined for Patient', () => {
            expect(manager.getPatientPropertyForPersonScopedResource({ resourceType: 'Patient' }))
                .toBeUndefined();
        });

        test('returns undefined for Observation', () => {
            expect(manager.getPatientPropertyForPersonScopedResource({ resourceType: 'Observation' }))
                .toBeUndefined();
        });

        test('does not throw for unknown resource type', () => {
            expect(() => {
                manager.getPatientPropertyForPersonScopedResource({ resourceType: 'NonExistent' });
            }).not.toThrow();
        });
    });

    describe('edge cases and robustness', () => {
        test('all patientFilterMapping values are non-empty strings', () => {
            for (const [resourceType, field] of Object.entries(manager.patientFilterMapping)) {
                expect(typeof field).toBe('string');
                expect(field.length).toBeGreaterThan(0);
            }
        });

        test('all personFilterWithQueryMapping values contain {person} placeholder', () => {
            for (const [resourceType, query] of Object.entries(manager.personFilterWithQueryMapping)) {
                expect(query).toContain('{person}');
            }
        });

        test('all personFilterWithQueryMapping values have key=system|value format', () => {
            for (const [resourceType, query] of Object.entries(manager.personFilterWithQueryMapping)) {
                // Should match pattern: field=system|{person}
                expect(query).toMatch(/^[a-z]+=https?:\/\/.+\|\{person\}$/);
            }
        });

        test('patientFilterMapping does not contain Subscription resources', () => {
            // Subscription resources use custom query logic, not direct patient references
            expect(manager.patientFilterMapping).not.toHaveProperty('Subscription');
            expect(manager.patientFilterMapping).not.toHaveProperty('SubscriptionStatus');
            expect(manager.patientFilterMapping).not.toHaveProperty('SubscriptionTopic');
        });

        test('constructor creates independent instances', () => {
            const manager1 = new PatientFilterManager();
            const manager2 = new PatientFilterManager();
            // Modifying one should not affect the other
            manager1.patientFilterMapping.TestResource = 'test.reference';
            expect(manager2.patientFilterMapping).not.toHaveProperty('TestResource');
        });
    });
});
