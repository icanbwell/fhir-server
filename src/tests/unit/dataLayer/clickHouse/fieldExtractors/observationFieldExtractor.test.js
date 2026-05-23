'use strict';

const { describe, test, beforeEach, expect } = require('@jest/globals');
const { ObservationFieldExtractor } = require('../../../../../dataLayer/clickHouse/fieldExtractors/observationFieldExtractor');

describe('ObservationFieldExtractor', () => {
    let extractor;

    beforeEach(() => {
        extractor = new ObservationFieldExtractor();
    });

    // ─── Helper factories ───────────────────────────────────────
    function makeObservation (overrides = {}) {
        return {
            resourceType: 'Observation',
            id: 'obs-1',
            _uuid: 'uuid-obs-1',
            _sourceId: 'Observation/obs-1',
            status: 'final',
            meta: {
                versionId: '1',
                lastUpdated: '2024-06-15T10:30:00.000Z',
                source: 'device://fitbit',
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                    { system: 'https://www.icanbwell.com/owner', code: 'org-1' }
                ]
            },
            code: {
                coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }]
            },
            category: [
                { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }
            ],
            subject: { reference: 'Patient/patient-1' },
            device: { reference: 'Device/device-1' },
            encounter: { reference: 'Encounter/encounter-1' },
            effectiveDateTime: '2024-06-15T10:30:00.000Z',
            valueQuantity: { value: 72, unit: 'beats/minute', code: '/min' },
            ...overrides
        };
    }

    function makeBPObservation (overrides = {}) {
        return makeObservation({
            code: {
                coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }]
            },
            valueQuantity: undefined,
            component: [
                {
                    code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic' }] },
                    valueQuantity: { value: 120, unit: 'mmHg', code: 'mm[Hg]' }
                },
                {
                    code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic' }] },
                    valueQuantity: { value: 80, unit: 'mmHg', code: 'mm[Hg]' }
                }
            ],
            ...overrides
        });
    }

    // ─── Heart rate / valueQuantity ─────────────────────────────

    describe('heart rate observation (valueQuantity with numeric value)', () => {
        test('extracts value_quantity_value, unit, and code', () => {
            const row = extractor.extract(makeObservation());

            expect(row.value_quantity_value).toBe(72);
            expect(row.value_quantity_unit).toBe('beats/minute');
            expect(row.value_quantity_code).toBe('/min');
        });

        test('component fields are null for non-BP observations', () => {
            const row = extractor.extract(makeObservation());

            expect(row.component_systolic).toBeNull();
            expect(row.component_diastolic).toBeNull();
        });

        test('code_code and code_system are extracted from first coding', () => {
            const row = extractor.extract(makeObservation());

            expect(row.code_code).toBe('8867-4');
            expect(row.code_system).toBe('http://loinc.org');
        });
    });

    // ─── SpO2 / percentage ──────────────────────────────────────

    describe('SpO2 observation (valueQuantity with percentage)', () => {
        test('extracts percentage value', () => {
            const row = extractor.extract(makeObservation({
                code: {
                    coding: [{ system: 'http://loinc.org', code: '2708-6', display: 'Oxygen saturation' }]
                },
                valueQuantity: { value: 98, unit: '%', code: '%' }
            }));

            expect(row.value_quantity_value).toBe(98);
            expect(row.value_quantity_unit).toBe('%');
            expect(row.value_quantity_code).toBe('%');
            expect(row.code_code).toBe('2708-6');
        });
    });

    // ─── BP panel ───────────────────────────────────────────────

    describe('BP panel observation (code 85354-9)', () => {
        test('extracts systolic and diastolic from components', () => {
            const row = extractor.extract(makeBPObservation());

            expect(row.component_systolic).toBe(120);
            expect(row.component_diastolic).toBe(80);
        });

        test('value_quantity fields are null for BP (not populated)', () => {
            const row = extractor.extract(makeBPObservation());

            expect(row.value_quantity_value).toBeNull();
            expect(row.value_quantity_unit).toBe('');
            expect(row.value_quantity_code).toBe('');
        });

        test('code_code is BP panel code', () => {
            const row = extractor.extract(makeBPObservation());

            expect(row.code_code).toBe('85354-9');
            expect(row.code_system).toBe('http://loinc.org');
        });
    });

    // ─── BP with only systolic ──────────────────────────────────

    describe('BP with only systolic (diastolic absent)', () => {
        test('systolic is populated, diastolic is null', () => {
            const row = extractor.extract(makeBPObservation({
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 130, unit: 'mmHg' }
                    }
                    // No diastolic component at all
                ]
            }));

            expect(row.component_systolic).toBe(130);
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── BP with dataAbsentReason ───────────────────────────────

    describe('BP with dataAbsentReason (no valueQuantity on component)', () => {
        test('component present but no valueQuantity yields null', () => {
            const row = extractor.extract(makeBPObservation({
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 120, unit: 'mmHg' }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        dataAbsentReason: {
                            coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' }]
                        }
                        // No valueQuantity
                    }
                ]
            }));

            expect(row.component_systolic).toBe(120);
            expect(row.component_diastolic).toBeNull();
        });

        test('both components with dataAbsentReason yield both null', () => {
            const row = extractor.extract(makeBPObservation({
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        dataAbsentReason: { coding: [{ code: 'unknown' }] }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        dataAbsentReason: { coding: [{ code: 'unknown' }] }
                    }
                ]
            }));

            expect(row.component_systolic).toBeNull();
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── BP with empty component array ──────────────────────────

    describe('BP with empty component array', () => {
        test('empty array yields both components null', () => {
            const row = extractor.extract(makeBPObservation({
                component: []
            }));

            expect(row.component_systolic).toBeNull();
            expect(row.component_diastolic).toBeNull();
        });

        test('undefined component yields both components null', () => {
            const resource = makeBPObservation();
            delete resource.component;
            const row = extractor.extract(resource);

            expect(row.component_systolic).toBeNull();
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── BP with malformed component ────────────────────────────

    describe('BP with malformed component (no code)', () => {
        test('component without code is skipped gracefully', () => {
            const row = extractor.extract(makeBPObservation({
                component: [
                    { valueQuantity: { value: 999 } }, // No code at all
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 120, unit: 'mmHg' }
                    }
                ]
            }));

            expect(row.component_systolic).toBe(120);
            expect(row.component_diastolic).toBeNull();
        });

        test('null component entry is skipped', () => {
            const row = extractor.extract(makeBPObservation({
                component: [
                    null,
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] },
                        valueQuantity: { value: 80 }
                    }
                ]
            }));

            expect(row.component_systolic).toBeNull();
            expect(row.component_diastolic).toBe(80);
        });

        test('component with empty code object is skipped', () => {
            const row = extractor.extract(makeBPObservation({
                component: [
                    {
                        code: {},
                        valueQuantity: { value: 999 }
                    },
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 115 }
                    }
                ]
            }));

            // Empty code.coding yields system '' which !== LOINC_SYSTEM, so skipped
            expect(row.component_systolic).toBe(115);
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── Non-LOINC system matching BP code ──────────────────────

    describe('non-LOINC system code that matches BP code', () => {
        test('code 85354-9 with non-LOINC system is NOT treated as BP', () => {
            const row = extractor.extract(makeObservation({
                code: {
                    coding: [{ system: 'http://example.com/custom', code: '85354-9' }]
                },
                valueQuantity: { value: 42, unit: 'mmHg', code: 'mm[Hg]' },
                component: [
                    {
                        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] },
                        valueQuantity: { value: 120 }
                    }
                ]
            }));

            // Should use valueQuantity path, NOT BP component extraction
            expect(row.value_quantity_value).toBe(42);
            expect(row.component_systolic).toBeNull();
            expect(row.component_diastolic).toBeNull();
        });
    });

    // ─── No valueQuantity ───────────────────────────────────────

    describe('observation with no valueQuantity', () => {
        test('value_quantity fields are null/empty when valueQuantity is missing', () => {
            const resource = makeObservation();
            delete resource.valueQuantity;
            const row = extractor.extract(resource);

            expect(row.value_quantity_value).toBeNull();
            expect(row.value_quantity_unit).toBe('');
            expect(row.value_quantity_code).toBe('');
        });

        test('value_quantity_value is null when valueQuantity.value is null', () => {
            const row = extractor.extract(makeObservation({
                valueQuantity: { value: null, unit: 'beats/minute' }
            }));

            expect(row.value_quantity_value).toBeNull();
            expect(row.value_quantity_unit).toBe('beats/minute');
        });

        test('value_quantity_value is null when valueQuantity.value is undefined', () => {
            const row = extractor.extract(makeObservation({
                valueQuantity: { unit: 'beats/minute' }
            }));

            expect(row.value_quantity_value).toBeNull();
        });

        test('value_quantity_value zero is preserved (not treated as falsy)', () => {
            const row = extractor.extract(makeObservation({
                valueQuantity: { value: 0, unit: 'score' }
            }));

            expect(row.value_quantity_value).toBe(0);
        });
    });

    // ─── meta.versionId parsing ─────────────────────────────────

    describe('meta.versionId parsing', () => {
        test('string "3" is parsed to number 3', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, versionId: '3' }
            }));

            expect(row.meta_version_id).toBe(3);
        });

        test('string "0" is parsed to number 0', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, versionId: '0' }
            }));

            expect(row.meta_version_id).toBe(0);
        });

        test('numeric 5 (already a number) is parsed to 5', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, versionId: 5 }
            }));

            // parseInt('5', 10) is still called on non-string but parseInt coerces
            expect(row.meta_version_id).toBe(5);
        });

        test('non-numeric string defaults to 0', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, versionId: 'abc' }
            }));

            expect(row.meta_version_id).toBe(0);
        });
    });

    describe('meta.versionId missing', () => {
        test('undefined versionId defaults to 0', () => {
            const resource = makeObservation();
            delete resource.meta.versionId;
            const row = extractor.extract(resource);

            expect(row.meta_version_id).toBe(0);
        });

        test('null versionId defaults to 0', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, versionId: null }
            }));

            expect(row.meta_version_id).toBe(0);
        });

        test('empty string versionId defaults to 0', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, versionId: '' }
            }));

            expect(row.meta_version_id).toBe(0);
        });

        test('missing meta entirely defaults versionId to 0', () => {
            const resource = makeObservation();
            delete resource.meta;
            const row = extractor.extract(resource);

            expect(row.meta_version_id).toBe(0);
        });
    });

    // ─── Security tag extraction ────────────────────────────────

    describe('security tag extraction', () => {
        test('access_tags extracted by system URL', () => {
            const row = extractor.extract(makeObservation());

            expect(row.access_tags).toEqual(['client-a']);
        });

        test('owner_tags extracted by system URL', () => {
            const row = extractor.extract(makeObservation());

            expect(row.owner_tags).toEqual(['org-1']);
        });

        test('multiple access tags are all extracted', () => {
            const row = extractor.extract(makeObservation({
                meta: {
                    ...makeObservation().meta,
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: 'client-a' },
                        { system: 'https://www.icanbwell.com/access', code: 'client-b' },
                        { system: 'https://www.icanbwell.com/owner', code: 'org-1' }
                    ]
                }
            }));

            expect(row.access_tags).toEqual(['client-a', 'client-b']);
            expect(row.owner_tags).toEqual(['org-1']);
        });

        test('source_assigning_authority from first owner tag', () => {
            const row = extractor.extract(makeObservation());

            expect(row.source_assigning_authority).toBe('org-1');
        });

        test('empty security array yields empty arrays', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, security: [] }
            }));

            expect(row.access_tags).toEqual([]);
            expect(row.owner_tags).toEqual([]);
            expect(row.source_assigning_authority).toBe('');
        });

        test('missing security yields empty arrays', () => {
            const resource = makeObservation();
            delete resource.meta.security;
            const row = extractor.extract(resource);

            expect(row.access_tags).toEqual([]);
            expect(row.owner_tags).toEqual([]);
        });

        test('security tags with null code are filtered out', () => {
            const row = extractor.extract(makeObservation({
                meta: {
                    ...makeObservation().meta,
                    security: [
                        { system: 'https://www.icanbwell.com/access', code: null },
                        { system: 'https://www.icanbwell.com/access', code: 'valid' }
                    ]
                }
            }));

            expect(row.access_tags).toEqual(['valid']);
        });
    });

    // ─── effective_datetime ─────────────────────────────────────

    describe('effective_datetime conversion', () => {
        test('ISO datetime converted to ClickHouse format', () => {
            const row = extractor.extract(makeObservation({
                effectiveDateTime: '2024-06-15T10:30:00.000Z'
            }));

            expect(row.effective_datetime).toBe('2024-06-15 10:30:00.000');
        });

        test('missing effectiveDateTime uses current time (non-null)', () => {
            const resource = makeObservation();
            delete resource.effectiveDateTime;
            const row = extractor.extract(resource);

            expect(row.effective_datetime).toBeTruthy();
            // Should be in ClickHouse format (no T, no Z)
            expect(row.effective_datetime).not.toContain('T');
            expect(row.effective_datetime).not.toContain('Z');
        });
    });

    // ─── _fhir_resource ─────────────────────────────────────────

    describe('_fhir_resource contains full serialized JSON', () => {
        test('plain object is serialized to JSON string', () => {
            const resource = makeObservation({ id: 'fhir-json-test' });
            const row = extractor.extract(resource);

            const parsed = JSON.parse(row._fhir_resource);
            expect(parsed.id).toBe('fhir-json-test');
            expect(parsed.resourceType).toBe('Observation');
            expect(parsed.valueQuantity.value).toBe(72);
        });

        test('object with toJSON method uses toJSON()', () => {
            const resource = makeObservation({ id: 'tojson-test' });
            resource.toJSON = () => ({ id: 'tojson-test', custom: true });

            const row = extractor.extract(resource);
            const parsed = JSON.parse(row._fhir_resource);

            expect(parsed.id).toBe('tojson-test');
            expect(parsed.custom).toBe(true);
            // Should NOT contain the original fields (toJSON returns different shape)
            expect(parsed.resourceType).toBeUndefined();
        });
    });

    // ─── Identity fields ────────────────────────────────────────

    describe('identity fields', () => {
        test('id, _uuid, _sourceId are extracted', () => {
            const row = extractor.extract(makeObservation());

            expect(row.id).toBe('obs-1');
            expect(row._uuid).toBe('uuid-obs-1');
            expect(row._sourceId).toBe('Observation/obs-1');
        });

        test('_uuid defaults to id when missing', () => {
            const resource = makeObservation();
            delete resource._uuid;
            const row = extractor.extract(resource);

            expect(row._uuid).toBe('obs-1');
        });

        test('_sourceId defaults to Observation/{id} when missing', () => {
            const resource = makeObservation();
            delete resource._sourceId;
            const row = extractor.extract(resource);

            expect(row._sourceId).toBe('Observation/obs-1');
        });

        test('missing id yields empty string', () => {
            const resource = makeObservation();
            delete resource.id;
            const row = extractor.extract(resource);

            expect(row.id).toBe('');
        });
    });

    // ─── Reference fields ───────────────────────────────────────

    describe('reference fields', () => {
        test('subject, device, encounter references extracted', () => {
            const row = extractor.extract(makeObservation());

            expect(row.subject_reference).toBe('Patient/patient-1');
            expect(row.device_reference).toBe('Device/device-1');
            expect(row.encounter_reference).toBe('Encounter/encounter-1');
        });

        test('missing subject yields empty string', () => {
            const resource = makeObservation();
            delete resource.subject;
            const row = extractor.extract(resource);

            expect(row.subject_reference).toBe('');
        });

        test('missing device yields empty string', () => {
            const resource = makeObservation();
            delete resource.device;
            const row = extractor.extract(resource);

            expect(row.device_reference).toBe('');
        });
    });

    // ─── Category extraction ────────────────────────────────────

    describe('category extraction', () => {
        test('category_code from first category first coding', () => {
            const row = extractor.extract(makeObservation());

            expect(row.category_code).toBe('vital-signs');
        });

        test('missing category yields empty string', () => {
            const resource = makeObservation();
            delete resource.category;
            const row = extractor.extract(resource);

            expect(row.category_code).toBe('');
        });
    });

    // ─── Meta fields ────────────────────────────────────────────

    describe('meta fields', () => {
        test('meta_last_updated converted to ClickHouse format', () => {
            const row = extractor.extract(makeObservation());

            expect(row.meta_last_updated).toBe('2024-06-15 10:30:00.000');
        });

        test('meta_source extracted', () => {
            const row = extractor.extract(makeObservation());

            expect(row.meta_source).toBe('device://fitbit');
        });

        test('missing meta_source defaults to empty string', () => {
            const row = extractor.extract(makeObservation({
                meta: { ...makeObservation().meta, source: undefined }
            }));

            expect(row.meta_source).toBe('');
        });
    });

    // ─── Status ─────────────────────────────────────────────────

    describe('status extraction', () => {
        test('status extracted from resource', () => {
            const row = extractor.extract(makeObservation({ status: 'preliminary' }));

            expect(row.status).toBe('preliminary');
        });

        test('missing status defaults to empty string', () => {
            const resource = makeObservation();
            delete resource.status;
            const row = extractor.extract(resource);

            expect(row.status).toBe('');
        });
    });

    // ─── Code edge cases ────────────────────────────────────────

    describe('code edge cases', () => {
        test('missing code object yields empty code_code and code_system', () => {
            const resource = makeObservation();
            delete resource.code;
            const row = extractor.extract(resource);

            expect(row.code_code).toBe('');
            expect(row.code_system).toBe('');
        });

        test('empty coding array yields empty code_code and code_system', () => {
            const row = extractor.extract(makeObservation({
                code: { coding: [] }
            }));

            expect(row.code_code).toBe('');
            expect(row.code_system).toBe('');
        });
    });
});
