'use strict';

const { describe, test, expect } = require('@jest/globals');
const { isColumnDateTimeType } = require('../../../operations/common/isColumnDateTimeType');

describe('isColumnDateTimeType', () => {
    test('returns true for meta.lastUpdated on any resource', () => {
        expect(isColumnDateTimeType('Patient', 'meta.lastUpdated')).toBe(true);
        expect(isColumnDateTimeType('Observation', 'meta.lastUpdated')).toBe(true);
    });

    test('returns true for resource.meta.lastUpdated on history resource', () => {
        expect(isColumnDateTimeType('Patient', 'resource.meta.lastUpdated', true)).toBe(true);
    });

    test('returns false for resource.meta.lastUpdated when NOT history resource', () => {
        expect(isColumnDateTimeType('Patient', 'resource.meta.lastUpdated', false)).toBe(false);
    });

    test('returns true for column names containing "instant"', () => {
        expect(isColumnDateTimeType('Patient', 'someInstantField')).toBe(true);
        expect(isColumnDateTimeType('Patient', 'instantValue')).toBe(true);
    });

    test('AuditEvent recorded is DateTime', () => {
        expect(isColumnDateTimeType('AuditEvent', 'recorded')).toBe(true);
    });

    test('Appointment start/end are DateTime', () => {
        expect(isColumnDateTimeType('Appointment', 'start')).toBe(true);
        expect(isColumnDateTimeType('Appointment', 'end')).toBe(true);
    });

    test('Bundle timestamp is DateTime', () => {
        expect(isColumnDateTimeType('Bundle', 'timestamp')).toBe(true);
    });

    test('Bundle signature.when is DateTime', () => {
        expect(isColumnDateTimeType('Bundle', 'signature.when')).toBe(true);
    });

    test('Observation issued is DateTime', () => {
        expect(isColumnDateTimeType('Observation', 'issued')).toBe(true);
    });

    test('Provenance recorded is DateTime', () => {
        expect(isColumnDateTimeType('Provenance', 'recorded')).toBe(true);
    });

    test('Slot start/end are DateTime', () => {
        expect(isColumnDateTimeType('Slot', 'start')).toBe(true);
        expect(isColumnDateTimeType('Slot', 'end')).toBe(true);
    });

    test('returns false for non-datetime columns', () => {
        expect(isColumnDateTimeType('Patient', 'name')).toBe(false);
        expect(isColumnDateTimeType('Observation', 'code')).toBe(false);
    });

    test('returns false for null/empty resourceType or columnName', () => {
        expect(isColumnDateTimeType(null, 'start')).toBe(false);
        expect(isColumnDateTimeType('Patient', null)).toBe(false);
        expect(isColumnDateTimeType('', 'start')).toBe(false);
    });

    test('DiagnosticReport issued is DateTime', () => {
        expect(isColumnDateTimeType('DiagnosticReport', 'issued')).toBe(true);
    });

    test('DocumentReference date is DateTime', () => {
        expect(isColumnDateTimeType('DocumentReference', 'date')).toBe(true);
    });

    test('Subscription end is DateTime', () => {
        expect(isColumnDateTimeType('Subscription', 'end')).toBe(true);
    });
});
