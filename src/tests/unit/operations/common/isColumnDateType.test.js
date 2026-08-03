'use strict';

const { describe, test, expect } = require('@jest/globals');
const { isColumnDateType } = require('../../../../operations/common/isColumnDateType');

describe('isColumnDateType', () => {
    test('returns false for null/undefined resourceType or columnName', () => {
        expect(isColumnDateType(null, 'date')).toBe(false);
        expect(isColumnDateType('Patient', null)).toBe(false);
        expect(isColumnDateType(undefined, undefined)).toBe(false);
        expect(isColumnDateType('', 'date')).toBe(false);
    });

    test('meta.lastUpdated is date type for any resource', () => {
        expect(isColumnDateType('Patient', 'meta.lastUpdated')).toBe(true);
        expect(isColumnDateType('Observation', 'meta.lastUpdated')).toBe(true);
        expect(isColumnDateType('AnyResource', 'meta.lastUpdated')).toBe(true);
    });

    test('AuditEvent recorded is date type', () => {
        expect(isColumnDateType('AuditEvent', 'recorded')).toBe(true);
    });

    test('Patient date columns', () => {
        expect(isColumnDateType('Patient', 'birthDate')).toBe(true);
        expect(isColumnDateType('Patient', 'deceasedDateTime')).toBe(true);
        expect(isColumnDateType('Patient', 'contact.period.start')).toBe(true);
        expect(isColumnDateType('Patient', 'contact.period.end')).toBe(true);
    });

    test('Patient non-date columns return false', () => {
        expect(isColumnDateType('Patient', 'name')).toBe(false);
        expect(isColumnDateType('Patient', 'id')).toBe(false);
        expect(isColumnDateType('Patient', 'active')).toBe(false);
    });

    test('Observation date columns', () => {
        expect(isColumnDateType('Observation', 'effectiveDateTime')).toBe(true);
        expect(isColumnDateType('Observation', 'effectivePeriod.start')).toBe(true);
        expect(isColumnDateType('Observation', 'effectivePeriod.end')).toBe(true);
        expect(isColumnDateType('Observation', 'issued')).toBe(true);
        expect(isColumnDateType('Observation', 'valueDateTime')).toBe(true);
    });

    test('Encounter period columns', () => {
        expect(isColumnDateType('Encounter', 'period.start')).toBe(true);
        expect(isColumnDateType('Encounter', 'period.end')).toBe(true);
        expect(isColumnDateType('Encounter', 'participant.period.start')).toBe(true);
    });

    test('MedicationRequest date columns', () => {
        expect(isColumnDateType('MedicationRequest', 'authoredOn')).toBe(true);
        expect(isColumnDateType('MedicationRequest', 'dosageInstruction.timing.event')).toBe(true);
    });

    test('unknown resource type returns false', () => {
        expect(isColumnDateType('FakeResource', 'date')).toBe(false);
        expect(isColumnDateType('FakeResource', 'created')).toBe(false);
    });

    test('known resource with wrong column returns false', () => {
        expect(isColumnDateType('Appointment', 'nonexistentField')).toBe(false);
        expect(isColumnDateType('Condition', 'status')).toBe(false);
    });

    test('Provenance date columns', () => {
        expect(isColumnDateType('Provenance', 'recorded')).toBe(true);
        expect(isColumnDateType('Provenance', 'occurredDateTime')).toBe(true);
        expect(isColumnDateType('Provenance', 'occurredPeriod.start')).toBe(true);
    });

    test('Task date columns', () => {
        expect(isColumnDateType('Task', 'authoredOn')).toBe(true);
        expect(isColumnDateType('Task', 'lastModified')).toBe(true);
        expect(isColumnDateType('Task', 'executionPeriod.start')).toBe(true);
        expect(isColumnDateType('Task', 'input.valueDateTime')).toBe(true);
    });

    test('Bundle timestamp and entry dates', () => {
        expect(isColumnDateType('Bundle', 'timestamp')).toBe(true);
        expect(isColumnDateType('Bundle', 'entry.request.ifModifiedSince')).toBe(true);
        expect(isColumnDateType('Bundle', 'entry.response.lastModified')).toBe(true);
    });
});
