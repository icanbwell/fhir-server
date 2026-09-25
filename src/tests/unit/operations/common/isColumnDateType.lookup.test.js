'use strict';

/**
 * Category A (must PASS) coverage for src/operations/common/isColumnDateType.js.
 *
 * Oracle: src/fhir/fhir-generated.field-types.json is the repo's own generated FHIR R4B
 * element->type map (e.g. "Patient.birthDate" -> {code: "date"}). It is a data file, not a
 * source file, so using it here is a real runtime oracle rather than a source-text assertion.
 */

const { describe, test, expect } = require('@jest/globals');

const { isColumnDateType } = require('../../../../operations/common/isColumnDateType');
const fhirFieldTypes = require('../../../../fhir/fhir-generated.field-types.json');

/** FHIR primitive types that MUST be treated as date columns by a date search parameter. */
const DATE_PRIMITIVE_CODES = new Set(['date', 'dateTime', 'instant', 'time']);

/**
 * Returns every flattened element path on `resourceType` whose generated FHIR type is a
 * date-ish primitive, e.g. for 'Patient' -> ['birthDate', 'deceasedDateTime', ...].
 * @param {string} resourceType
 * @returns {string[]}
 */
function dateLeafPathsFor (resourceType) {
    const prefix = `${resourceType}.`;
    return Object.entries(fhirFieldTypes)
        .filter(([path, def]) => path.startsWith(prefix) && DATE_PRIMITIVE_CODES.has(def.code))
        .map(([path]) => path.slice(prefix.length));
}

/**
 * Returns element paths on `resourceType` that are definitively NOT date-ish primitives
 * (string/boolean/code/integer/uri/decimal). Complex types (Period, Timing, ...) are excluded
 * because their sub-paths legitimately resolve to dates.
 * @param {string} resourceType
 * @returns {string[]}
 */
function nonDateLeafPathsFor (resourceType) {
    const scalarNonDate = new Set([
        'string', 'boolean', 'code', 'integer', 'positiveInt', 'unsignedInt', 'uri', 'url',
        'canonical', 'decimal', 'markdown', 'id', 'oid', 'uuid', 'base64Binary'
    ]);
    const prefix = `${resourceType}.`;
    return Object.entries(fhirFieldTypes)
        .filter(([path, def]) => path.startsWith(prefix) && scalarNonDate.has(def.code))
        .map(([path]) => path.slice(prefix.length));
}

describe('isColumnDateType — argument guards', () => {
    test('returns false (never throws) for every falsy resourceType', () => {
        const falsyValues = [null, undefined, '', 0, false, NaN];
        for (const value of falsyValues) {
            expect(isColumnDateType(value, 'birthDate')).toBe(false);
        }
    });

    test('returns false (never throws) for every falsy columnName', () => {
        const falsyValues = [null, undefined, '', 0, false, NaN];
        for (const value of falsyValues) {
            expect(isColumnDateType('Patient', value)).toBe(false);
        }
    });

    test('returns false when called with no arguments at all', () => {
        expect(isColumnDateType()).toBe(false);
    });

    test('returns a strict boolean, never a truthy/falsy non-boolean', () => {
        const positive = isColumnDateType('Patient', 'birthDate');
        const negative = isColumnDateType('Patient', 'gender');
        expect(typeof positive).toBe('boolean');
        expect(typeof negative).toBe('boolean');
        expect(positive).toBe(true);
        expect(negative).toBe(false);
    });

    test('does not throw and returns false for non-string argument types', () => {
        expect(isColumnDateType({ resourceType: 'Patient' }, 'birthDate')).toBe(false);
        expect(isColumnDateType('Patient', { name: 'birthDate' })).toBe(false);
        expect(isColumnDateType(['Patient'], ['birthDate'])).toBe(false);
        expect(isColumnDateType(42, 7)).toBe(false);
    });
});

describe('isColumnDateType — meta.lastUpdated is resource-independent', () => {
    test('meta.lastUpdated is a date column for known, unknown and bogus resource types', () => {
        const resourceTypes = ['Patient', 'Observation', 'AuditEvent', 'NotAFhirResource', 'x'];
        for (const resourceType of resourceTypes) {
            expect(isColumnDateType(resourceType, 'meta.lastUpdated')).toBe(true);
        }
    });

    test('near-miss spellings of meta.lastUpdated are NOT treated as date columns', () => {
        expect(isColumnDateType('Patient', 'meta.lastupdated')).toBe(false);
        expect(isColumnDateType('Patient', 'meta.lastUpdated ')).toBe(false);
        expect(isColumnDateType('Patient', 'lastUpdated')).toBe(false);
        expect(isColumnDateType('Patient', 'resource.meta.lastUpdated')).toBe(false);
    });
});

describe('isColumnDateType — verified against the generated FHIR R4B element-type map', () => {
    // These resource types are fully correct in the lookup table today. Any future edit that
    // drops or misspells one of their date elements breaks these tests.
    // NOTE: Encounter/Coverage/Schedule are deliberately absent — every one of their date
    // elements lives inside a `Period` complex type, which this oracle does not flatten, so
    // they would yield an empty (vacuous) expectation. They are covered explicitly by the
    // "Period / Timing sub-paths" block below.
    const correctResourceTypes = [
        'Patient',
        'Observation',
        'Condition',
        'DocumentReference',
        'Procedure',
        'AuditEvent',
        'DiagnosticReport',
        'MedicationRequest',
        'MedicationStatement',
        'Provenance',
        'RelatedPerson',
        'ServiceRequest',
        'Goal',
        'Consent',
        'Appointment',
        'Slot'
    ];

    for (const resourceType of correctResourceTypes) {
        test(`${resourceType}: every date/dateTime/instant/time element is recognised`, () => {
            const expectedDatePaths = dateLeafPathsFor(resourceType);
            // Guard the oracle itself — an empty list would make this test vacuous.
            expect(expectedDatePaths.length).toBeGreaterThan(0);

            const unrecognised = expectedDatePaths.filter(
                (path) => !isColumnDateType(resourceType, path)
            );
            expect(unrecognised).toEqual([]);
        });
    }

    test('no false positives: non-date scalar elements are never reported as dates', () => {
        const resourceTypes = ['Patient', 'Observation', 'Encounter', 'Condition', 'Procedure'];
        const falsePositives = [];
        for (const resourceType of resourceTypes) {
            for (const path of nonDateLeafPathsFor(resourceType)) {
                if (isColumnDateType(resourceType, path)) {
                    falsePositives.push(`${resourceType}.${path}`);
                }
            }
        }
        expect(falsePositives).toEqual([]);
    });
});

describe('isColumnDateType — Period / Timing sub-paths', () => {
    test('Encounter resolves both ends of every Period it exposes', () => {
        expect(isColumnDateType('Encounter', 'period.start')).toBe(true);
        expect(isColumnDateType('Encounter', 'period.end')).toBe(true);
        expect(isColumnDateType('Encounter', 'location.period.start')).toBe(true);
        expect(isColumnDateType('Encounter', 'location.period.end')).toBe(true);
        expect(isColumnDateType('Encounter', 'statusHistory.period.start')).toBe(true);
        expect(isColumnDateType('Encounter', 'statusHistory.period.end')).toBe(true);
    });

    test('the bare Period element (no .start/.end) is NOT a date column', () => {
        // Mongo cannot range-compare a {start,end} sub-document as a date.
        expect(isColumnDateType('Encounter', 'period')).toBe(false);
        expect(isColumnDateType('Coverage', 'period')).toBe(false);
        expect(isColumnDateType('Observation', 'effectivePeriod')).toBe(false);
    });

    test('Timing repeat bounds and timeOfDay resolve for MedicationRequest and CarePlan', () => {
        expect(isColumnDateType('MedicationRequest', 'dosageInstruction.timing.event')).toBe(true);
        expect(
            isColumnDateType('MedicationRequest', 'dosageInstruction.timing.repeat.boundsPeriod.start')
        ).toBe(true);
        expect(
            isColumnDateType('MedicationRequest', 'dosageInstruction.timing.repeat.timeOfDay')
        ).toBe(true);
        expect(
            isColumnDateType('CarePlan', 'activity.detail.scheduledTiming.repeat.boundsPeriod.end')
        ).toBe(true);
    });

    test('Task resolves both input and output value[x] date variants', () => {
        for (const column of [
            'input.valueDate',
            'input.valueDateTime',
            'input.valueTime',
            'input.valueInstant',
            'input.valuePeriod.start',
            'output.valueDate',
            'output.valueDateTime',
            'output.valueInstant',
            'output.valuePeriod.end',
            'restriction.period.start'
        ]) {
            expect(isColumnDateType('Task', column)).toBe(true);
        }
    });
});

describe('isColumnDateType — unknown resource types and unknown columns', () => {
    test('an unknown resource type never matches, even for a column valid elsewhere', () => {
        expect(isColumnDateType('FakeResource', 'birthDate')).toBe(false);
        expect(isColumnDateType('FakeResource', 'period.start')).toBe(false);
        expect(isColumnDateType('Patient2', 'birthDate')).toBe(false);
        // ...but the resource-independent column still wins.
        expect(isColumnDateType('FakeResource', 'meta.lastUpdated')).toBe(true);
    });

    test('a known resource type does not inherit another resource type\'s date columns', () => {
        // birthDate belongs to Patient/Person/Practitioner/RelatedPerson only.
        expect(isColumnDateType('Observation', 'birthDate')).toBe(false);
        expect(isColumnDateType('Encounter', 'birthDate')).toBe(false);
        // recorded belongs to AuditEvent/Provenance.
        expect(isColumnDateType('Patient', 'recorded')).toBe(false);
        expect(isColumnDateType('Observation', 'recorded')).toBe(false);
    });

    test('unknown columns on a known resource type return false', () => {
        expect(isColumnDateType('Patient', 'nonexistentField')).toBe(false);
        expect(isColumnDateType('Encounter', 'status')).toBe(false);
        expect(isColumnDateType('Observation', 'code.coding.code')).toBe(false);
    });
});

describe('isColumnDateType — matching is exact and case sensitive', () => {
    test('resourceType matching is case sensitive (Mongo collection names are too)', () => {
        expect(isColumnDateType('Patient', 'birthDate')).toBe(true);
        expect(isColumnDateType('patient', 'birthDate')).toBe(false);
        expect(isColumnDateType('PATIENT', 'birthDate')).toBe(false);
        expect(isColumnDateType('pAtIeNt', 'birthDate')).toBe(false);
    });

    test('columnName matching is case sensitive', () => {
        expect(isColumnDateType('Patient', 'birthdate')).toBe(false);
        expect(isColumnDateType('Patient', 'BirthDate')).toBe(false);
        expect(isColumnDateType('Observation', 'effectivedatetime')).toBe(false);
    });

    test('leading/trailing whitespace is not tolerated', () => {
        expect(isColumnDateType('Patient', ' birthDate')).toBe(false);
        expect(isColumnDateType('Patient', 'birthDate ')).toBe(false);
        expect(isColumnDateType(' Patient', 'birthDate')).toBe(false);
    });

    test('partial path prefixes and suffixes do not match', () => {
        expect(isColumnDateType('Encounter', 'period.')).toBe(false);
        expect(isColumnDateType('Encounter', '.period.start')).toBe(false);
        expect(isColumnDateType('Patient', 'birth')).toBe(false);
        expect(isColumnDateType('Patient', 'birthDateTime')).toBe(false);
    });
});

describe('isColumnDateType — hostile input (search parameters are caller-controlled)', () => {
    test('Object.prototype keys supplied as a columnName never match', () => {
        // columnName reaches this function from the query string. A lookup implemented with a
        // plain object would happily resolve '__proto__'/'constructor'/'toString'; the switch
        // must not, or a caller could coerce an arbitrary field into date-range handling.
        for (const hostile of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf']) {
            expect(isColumnDateType('Patient', hostile)).toBe(false);
            expect(isColumnDateType('AuditEvent', hostile)).toBe(false);
        }
    });

    test('Object.prototype keys supplied as a resourceType never match', () => {
        for (const hostile of ['__proto__', 'constructor', 'prototype', 'toString']) {
            expect(isColumnDateType(hostile, 'birthDate')).toBe(false);
            expect(isColumnDateType(hostile, 'recorded')).toBe(false);
        }
    });

    test('calling with hostile input leaves Object.prototype unpolluted', () => {
        isColumnDateType('__proto__', '__proto__');
        isColumnDateType('Patient', 'constructor.prototype.polluted');
        expect({}.polluted).toBeUndefined();
        expect(Object.prototype.polluted).toBeUndefined();
    });

    test('[BL-§24] AuditEvent.recorded resolves as a date column so the mandatory audit date-range bound is a date comparison', () => {
        // Business-logic invariant: "AuditEvent queries MUST supply required date range filter."
        // If `recorded` were not recognised as a date, the bound would be built as a string
        // comparison against a BSON Date and silently match nothing.
        expect(isColumnDateType('AuditEvent', 'recorded')).toBe(true);
        // And the generated type map agrees it is an instant.
        expect(fhirFieldTypes['AuditEvent.recorded'].code).toBe('instant');
    });
});
