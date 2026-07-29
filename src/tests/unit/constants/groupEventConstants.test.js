'use strict';

const { describe, test, expect } = require('@jest/globals');
const { MEMBER_RESOURCE_TYPES } = require('../../../constants/groupEventConstants');

describe('groupEventConstants', () => {
    test('MEMBER_RESOURCE_TYPES is an array', () => {
        expect(Array.isArray(MEMBER_RESOURCE_TYPES)).toBe(true);
    });

    test('includes Patient', () => {
        expect(MEMBER_RESOURCE_TYPES).toContain('Patient');
    });

    test('includes Practitioner', () => {
        expect(MEMBER_RESOURCE_TYPES).toContain('Practitioner');
    });

    test('includes PractitionerRole', () => {
        expect(MEMBER_RESOURCE_TYPES).toContain('PractitionerRole');
    });

    test('includes Device', () => {
        expect(MEMBER_RESOURCE_TYPES).toContain('Device');
    });

    test('includes Medication', () => {
        expect(MEMBER_RESOURCE_TYPES).toContain('Medication');
    });

    test('includes Substance', () => {
        expect(MEMBER_RESOURCE_TYPES).toContain('Substance');
    });

    test('includes Group (nested groups)', () => {
        expect(MEMBER_RESOURCE_TYPES).toContain('Group');
    });

    test('has exactly 7 resource types per FHIR R4B spec', () => {
        expect(MEMBER_RESOURCE_TYPES).toHaveLength(7);
    });

    test('does not include non-member resources', () => {
        expect(MEMBER_RESOURCE_TYPES).not.toContain('Observation');
        expect(MEMBER_RESOURCE_TYPES).not.toContain('Encounter');
        expect(MEMBER_RESOURCE_TYPES).not.toContain('Organization');
    });
});
