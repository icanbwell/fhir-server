'use strict';

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('@jest/globals');

const {
    CompositionResourceMapper,
    SOURCE_RESOURCE_EXTENSION_URL
} = require('../../../../utils/compositionResourceMapper/compositionResourceMapper');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures');
const SENSITIVITY_SYSTEM = 'https://www.icanbwell.com/sensitivity-category';
const COMPOSITION_TYPE_SYSTEM = 'https://fhir.icanbwell.com/4_0_0/CodeSystem/composition';

function row(title, value) {
    return { title, text: { status: 'generated', div: value } };
}

function resourceSection({ references, code, rows = [], sections = [], extension }) {
    return {
        code,
        extension,
        entry: references.map((reference) => ({ reference, type: reference.split('/')[0] })),
        section: [...rows, ...sections]
    };
}

function composition(typeCode, sections) {
    return {
        resourceType: 'Composition',
        id: 'composition-1',
        title: 'Synthetic summary',
        meta: {
            source: 'https://www.icanbwell.com/fhir-composition-service',
            security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }]
        },
        subject: { reference: 'Patient/person.test-person-1', type: 'Patient' },
        type: { coding: [{ system: COMPOSITION_TYPE_SYSTEM, code: typeCode }] },
        section: sections
    };
}

function loadFixtureCompositions() {
    const compositions = [];
    for (const fixtureCase of fs.readdirSync(FIXTURE_ROOT)) {
        const caseDir = path.join(FIXTURE_ROOT, fixtureCase);
        for (const file of fs.readdirSync(caseDir)) {
            const bundle = JSON.parse(fs.readFileSync(path.join(caseDir, file), 'utf8'));
            for (const entry of bundle.entry) {
                if (entry.resource.resourceType === 'Composition') {
                    compositions.push({ name: `${fixtureCase}/${file}`, resource: entry.resource });
                }
            }
        }
    }
    return compositions;
}

function mapOne(typeCode, section) {
    const mapper = new CompositionResourceMapper();
    return mapper.mapComposition(composition(typeCode, [section]));
}

describe('CompositionResourceMapper', () => {
    describe('Condition', () => {
        const section = resourceSection({
            references: ['Condition/cond-1', 'Condition/cond-1-source-b'],
            code: {
                coding: [
                    { system: 'http://snomed.info/sct', code: '44054006', display: 'Diabetes' }
                ],
                text: 'Diabetes'
            },
            rows: [
                row('Condition Name', 'Type 2 Diabetes Mellitus'),
                row('Source', 'Source-A, Source-B'),
                row('Category', 'Unknown'),
                row('Onset Date', '2025-12-01T04:30:00+00:00'),
                row('Is Chronic', 'Yes'),
                row('Status', 'Active')
            ]
        });

        test('builds one resource per section with typed fields', () => {
            const { resources } = mapOne('condition_summary_document', section);

            expect(resources).toHaveLength(1);
            expect(resources[0]).toMatchObject({
                resourceType: 'Condition',
                subject: { reference: 'Patient/person.test-person-1' },
                code: {
                    coding: [{ system: 'http://snomed.info/sct', code: '44054006' }],
                    text: 'Type 2 Diabetes Mellitus'
                },
                onsetDateTime: '2025-12-01T04:30:00+00:00',
                clinicalStatus: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                            code: 'active'
                        }
                    ]
                }
            });
        });

        test('omits typed fields whose row holds a placeholder', () => {
            const { resources } = mapOne('condition_summary_document', section);

            expect(resources[0].category).toBeUndefined();
        });

        test('links every source resource of the group', () => {
            const { resources } = mapOne('condition_summary_document', section);

            const sources = resources[0].extension
                .filter((e) => e.url === SOURCE_RESOURCE_EXTENSION_URL)
                .map((e) => e.valueReference.reference);
            expect(sources).toEqual(['Condition/cond-1', 'Condition/cond-1-source-b']);
        });

        test('keeps every row, including ones with no FHIR field, in the narrative', () => {
            const { resources } = mapOne('condition_summary_document', section);

            expect(resources[0].text.status).toBe('generated');
            expect(resources[0].text.div).toContain('Is Chronic');
            expect(resources[0].text.div).toContain('Source-A, Source-B');
        });

        test('copies the composition security tags and source', () => {
            const { resources } = mapOne('condition_summary_document', section);

            expect(resources[0].meta).toEqual({
                source: 'https://www.icanbwell.com/fhir-composition-service',
                security: [{ system: 'https://www.icanbwell.com/owner', code: 'bwell' }]
            });
        });

        test('produces the same id on every run and a different id per group', () => {
            const other = resourceSection({
                references: ['Condition/cond-2'],
                rows: [row('Condition Name', 'Asthma')]
            });
            const mapper = new CompositionResourceMapper();
            const input = composition('condition_summary_document', [section, other]);

            const first = mapper.mapComposition(input).resources.map((r) => r.id);
            const second = mapper.mapComposition(input).resources.map((r) => r.id);

            expect(first).toEqual(second);
            expect(new Set(first).size).toBe(2);
        });
    });

    describe('section code', () => {
        test('moves sensitivity codings from the code to meta.security', () => {
            const { resources } = mapOne(
                'condition_summary_document',
                resourceSection({
                    references: ['Condition/cond-1'],
                    code: {
                        coding: [
                            { system: 'http://snomed.info/sct', code: '44054006' },
                            { system: SENSITIVITY_SYSTEM, code: 'behavioral-health' }
                        ]
                    }
                })
            );

            expect(resources[0].code.coding).toEqual([
                { system: 'http://snomed.info/sct', code: '44054006' }
            ]);
            expect(resources[0].meta.security).toContainEqual({
                system: SENSITIVITY_SYSTEM,
                code: 'behavioral-health'
            });
        });

        test.each([['null'], [''], [undefined]])('drops a coding whose code is %p', (code) => {
            const { resources } = mapOne(
                'condition_summary_document',
                resourceSection({
                    references: ['Condition/cond-1'],
                    code: { coding: [{ system: 'http://snomed.info/sct', code }] },
                    rows: [row('Symptom Name', 'Pregnant')]
                })
            );

            expect(resources[0].code).toEqual({ text: 'Pregnant' });
        });
    });

    describe('row values', () => {
        test('unescapes HTML entities for typed fields and re-escapes them in the narrative', () => {
            const { resources } = mapOne(
                'procedure_summary_document',
                resourceSection({
                    references: ['Procedure/proc-1'],
                    rows: [row('Latest Note', 'A &amp; B &lt;script&gt;')]
                })
            );

            expect(resources[0].note).toEqual([{ text: 'A & B <script>' }]);
            expect(resources[0].text.div).toContain('A &amp; B &lt;script&gt;');
            expect(resources[0].text.div).not.toContain('<script>');
        });

        test('truncates a date-time that has no timezone to its date', () => {
            const { resources } = mapOne(
                'lab_summary_document',
                resourceSection({
                    references: ['Observation/obs-1'],
                    rows: [row('Effective Date', '2026-01-01T00:00:00')]
                })
            );

            expect(resources[0].effectiveDateTime).toBe('2026-01-01');
        });

        test('leaves out a value it cannot parse and reports the row title only', () => {
            const { resources, report } = mapOne(
                'condition_summary_document',
                resourceSection({
                    references: ['Condition/cond-1'],
                    rows: [row('Onset Date', 'last spring')]
                })
            );

            expect(resources[0].onsetDateTime).toBeUndefined();
            expect(report.unparsedRows).toEqual([
                { resourceType: 'Condition', title: 'Onset Date' }
            ]);
        });

        test('reports a row title it has no mapping for', () => {
            const { report } = mapOne(
                'condition_summary_document',
                resourceSection({
                    references: ['Condition/cond-1'],
                    rows: [row('Brand New Row', 'value')]
                })
            );

            expect(report.unknownRows).toEqual([
                { resourceType: 'Condition', title: 'Brand New Row' }
            ]);
        });
    });

    describe('Procedure', () => {
        test('maps status, date, performer and text fields', () => {
            const { resources } = mapOne(
                'procedure_summary_document',
                resourceSection({
                    references: ['Procedure/proc-1'],
                    code: { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '99213' }] },
                    rows: [
                        row('Procedure Name', 'Office visit'),
                        row('Procedure Type', 'Evaluation and Management'),
                        row('Performed Date', '2026-01-01T00:00:00+00:00'),
                        row('Status', 'completed'),
                        row('Latest Reason', 'Follow up'),
                        row('Performer', 'Synthetic Clinician'),
                        row('Latest Location', 'Test Clinic'),
                        row('Latest Outcome', 'Not specified'),
                        row('Body Site', 'Left arm')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'Procedure',
                status: 'completed',
                code: { text: 'Office visit' },
                category: { text: 'Evaluation and Management' },
                performedDateTime: '2026-01-01T00:00:00+00:00',
                reasonCode: [{ text: 'Follow up' }],
                performer: [{ actor: { display: 'Synthetic Clinician' } }],
                location: { display: 'Test Clinic' },
                bodySite: [{ text: 'Left arm' }]
            });
            expect(resources[0].outcome).toBeUndefined();
        });
    });

    describe('AllergyIntolerance', () => {
        test('uses patient, coded statuses and a reaction', () => {
            const { resources } = mapOne(
                'allergyintolerance_summary_document',
                resourceSection({
                    references: ['AllergyIntolerance/allergy-1'],
                    rows: [
                        row('Allergen Name', 'Penicillin'),
                        row('Criticality', 'High'),
                        row('Category', 'Medication'),
                        row('Clinical Status', 'Active'),
                        row('Verification Status', 'Confirmed'),
                        row('Severity', 'Severe'),
                        row('Reaction', 'Hives'),
                        row('Recorder', 'Synthetic Clinician'),
                        row('Recorded Date', '2026-01-05T00:00:00+00:00')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'AllergyIntolerance',
                patient: { reference: 'Patient/person.test-person-1' },
                code: { text: 'Penicillin' },
                criticality: 'high',
                category: ['medication'],
                clinicalStatus: { coding: [{ code: 'active' }] },
                verificationStatus: { coding: [{ code: 'confirmed' }] },
                reaction: [{ manifestation: [{ text: 'Hives' }], severity: 'severe' }],
                recorder: { display: 'Synthetic Clinician' },
                recordedDate: '2026-01-05T00:00:00+00:00'
            });
            expect(resources[0].subject).toBeUndefined();
        });

        test('does not emit a reaction that has a severity but no manifestation', () => {
            const { resources } = mapOne(
                'allergyintolerance_summary_document',
                resourceSection({
                    references: ['AllergyIntolerance/allergy-1'],
                    rows: [row('Severity', 'Severe'), row('Reaction', 'Unknown')]
                })
            );

            expect(resources[0].reaction).toBeUndefined();
        });
    });

    describe('Immunization', () => {
        test('maps the vaccine code, occurrence, status and dose', () => {
            const { resources } = mapOne(
                'immunization_summary_document',
                resourceSection({
                    references: ['Immunization/imm-1'],
                    code: {
                        coding: [{ system: 'http://hl7.org/fhir/sid/cvx', code: '88' }],
                        text: 'Flu (Influenza)'
                    },
                    rows: [
                        row('Immunization Name', 'Flu (Influenza)'),
                        row('Vaccine Code Type', 'CVX'),
                        row('Vaccine Code', '140'),
                        row('occurrenceDateTime', '2026-01-01T00:00:00+00:00'),
                        row('Status', 'Completed'),
                        row('Primary Source', 'Unknown'),
                        row('Documented Vaccine Dose', '2')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'Immunization',
                patient: { reference: 'Patient/person.test-person-1' },
                status: 'completed',
                occurrenceDateTime: '2026-01-01T00:00:00+00:00',
                protocolApplied: [{ doseNumberString: '2' }]
            });
            expect(resources[0].vaccineCode.coding).toEqual([
                { system: 'http://hl7.org/fhir/sid/cvx', code: '88' },
                { system: 'http://hl7.org/fhir/sid/cvx', code: '140' }
            ]);
            expect(resources[0].primarySource).toBeUndefined();
        });
    });

    describe('Encounter', () => {
        test('splits the section code into class and type and maps the participant', () => {
            const { resources } = mapOne(
                'encounter_summary_document',
                resourceSection({
                    references: ['Encounter/enc-1'],
                    code: {
                        coding: [
                            {
                                system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
                                code: 'AMB',
                                display: 'Ambulatory'
                            },
                            { system: 'http://snomed.info/sct', code: '185349003' }
                        ]
                    },
                    rows: [
                        row('Visit Status', 'Finished'),
                        row('Date', '2026-01-01T00:00:00+00:00'),
                        row('Practitioner', 'Testgiven Testfamily'),
                        row('Practitioner NPI', '1234567893'),
                        row('Facility', 'Test Health Organization'),
                        row('Location Name', 'Test Clinic'),
                        row('Reason', 'Annual checkup')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'Encounter',
                status: 'finished',
                class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' },
                type: [{ coding: [{ system: 'http://snomed.info/sct', code: '185349003' }] }],
                period: { start: '2026-01-01T00:00:00+00:00' },
                participant: [
                    {
                        individual: {
                            display: 'Testgiven Testfamily',
                            identifier: {
                                system: 'http://hl7.org/fhir/sid/us-npi',
                                value: '1234567893'
                            }
                        }
                    }
                ],
                serviceProvider: { display: 'Test Health Organization' },
                location: [{ location: { display: 'Test Clinic' } }],
                reasonCode: [{ text: 'Annual checkup' }]
            });
        });
    });

    describe('CarePlan and DocumentReference', () => {
        test('maps care plan title, status, period and description', () => {
            const { resources } = mapOne(
                'careplan_summary_document',
                resourceSection({
                    references: ['CarePlan/cp-1'],
                    rows: [
                        row('CarePlan Name', 'Synthetic newer plan'),
                        row('Plan Type', 'Care plan'),
                        row('status', 'active'),
                        row('period.start', '2026-04-01'),
                        row('period.end', 'Not provided by source'),
                        row('created', '2026-04-01'),
                        row('Plan Details', 'Plan details not provided by source')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'CarePlan',
                title: 'Synthetic newer plan',
                status: 'active',
                category: [{ text: 'Care plan' }],
                period: { start: '2026-04-01' },
                created: '2026-04-01'
            });
            expect(resources[0].period.end).toBeUndefined();
            expect(resources[0].description).toBeUndefined();
        });

        test('maps document type, status and instant date', () => {
            const { resources } = mapOne(
                'document_summary_document',
                resourceSection({
                    references: ['DocumentReference/docref-1'],
                    code: { coding: [{ system: 'http://loinc.org', code: '34133-9' }] },
                    rows: [
                        row('Type', 'Summary of episode note'),
                        row('Date', '2026-01-02T00:00:00+00:00'),
                        row('Status', 'current')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'DocumentReference',
                status: 'current',
                date: '2026-01-02T00:00:00+00:00',
                type: {
                    coding: [{ system: 'http://loinc.org', code: '34133-9' }],
                    text: 'Summary of episode note'
                }
            });
        });
    });

    describe('MedicationStatement', () => {
        test('reuses the referenced statement id and links the request', () => {
            const { resources } = mapOne(
                'medication_summary_document',
                resourceSection({
                    references: ['MedicationStatement/70817798-e101-50a3-a3ad-b296f417f53b'],
                    code: {
                        coding: [
                            {
                                system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
                                code: '1049502'
                            }
                        ]
                    },
                    rows: [
                        row('Medication Name', 'Oxycodone (Oral)'),
                        row('MedicationRequest ID', 'mr-plain'),
                        row('Status', 'active'),
                        row('Prescriber', 'Synthetic Clinician'),
                        row('Authored On Date', '2026-03-01T00:00:00+00:00')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'MedicationStatement',
                id: '70817798-e101-50a3-a3ad-b296f417f53b',
                status: 'active',
                medicationCodeableConcept: {
                    coding: [{ code: '1049502' }],
                    text: 'Oxycodone (Oral)'
                },
                derivedFrom: [{ reference: 'MedicationRequest/mr-plain' }],
                informationSource: { display: 'Synthetic Clinician' },
                dateAsserted: '2026-03-01T00:00:00+00:00'
            });
            expect(resources[0].extension).toBeUndefined();
        });
    });

    describe('Observation and DiagnosticReport', () => {
        const diagnosticReport = resourceSection({
            references: ['DiagnosticReport/dr-1'],
            code: { coding: [{ system: 'http://loinc.org', code: '24323-8' }] },
            rows: [
                row('Status', 'final'),
                row('Issued', '2026-01-03T01:00:00+00:00'),
                row('Effective', '2026-01-03T00:00:00+00:00'),
                row('Result', 'Observation/obs-glucose, Observation/obs-sodium')
            ]
        });
        const glucose = resourceSection({
            references: ['Observation/obs-glucose'],
            code: { coding: [{ system: 'http://loinc.org', code: '2345-7' }] },
            extension: [
                {
                    url: 'https://fhir.icanbwell.com/4_0_0/StructureDefinition/observation-lab-is-core',
                    valueBoolean: true
                }
            ],
            rows: [
                row('Labs Name', 'Glucose, Blood'),
                row('Effective Date', '2026-01-03T00:00:00+00:00'),
                row('Category', 'laboratory'),
                row('Result Status', 'Final'),
                row('valueQuantity.value', '180'),
                row('valueQuantity.unit', 'mg/dL')
            ],
            sections: [{ title: 'Diagnostic Report', section: [diagnosticReport] }]
        });
        const outOfRange = {
            title: 'Out of Range Details',
            section: [
                resourceSection({
                    references: ['Observation/obs-glucose'],
                    rows: [row('Interpretation', 'High')]
                })
            ]
        };
        const panel = {
            title: 'Comprehensive Metabolic Panel (CMP)',
            code: { coding: [{ system: 'urn:lab-group', code: 'CMP' }] },
            section: [
                {
                    title: 'Glucose, Blood',
                    text: { status: 'generated', div: 'Observation.component' },
                    section: [glucose]
                },
                { title: 'Diagnostic Report', section: [diagnosticReport] },
                outOfRange
            ]
        };

        function mapPanel() {
            const mapper = new CompositionResourceMapper();
            return mapper.mapComposition(composition('lab_summary_document', [panel]));
        }

        test('maps a numeric lab result to a quantity with native source links', () => {
            const observation = mapPanel().resources.find((r) => r.resourceType === 'Observation');

            expect(observation).toMatchObject({
                status: 'final',
                code: { coding: [{ code: '2345-7' }], text: 'Glucose, Blood' },
                effectiveDateTime: '2026-01-03T00:00:00+00:00',
                category: [
                    {
                        coding: [
                            {
                                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                                code: 'laboratory'
                            }
                        ]
                    }
                ],
                valueQuantity: { value: 180, unit: 'mg/dL' },
                derivedFrom: [{ reference: 'Observation/obs-glucose' }]
            });
        });

        test('merges sections that reference the same source into one resource', () => {
            const observations = mapPanel().resources.filter(
                (r) => r.resourceType === 'Observation'
            );

            expect(observations).toHaveLength(1);
            expect(observations[0].interpretation).toEqual([
                {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                            code: 'H'
                        }
                    ],
                    text: 'High'
                }
            ]);
        });

        test('carries the section extensions onto the observation', () => {
            const observation = mapPanel().resources.find((r) => r.resourceType === 'Observation');

            expect(observation.extension).toContainEqual({
                url: 'https://fhir.icanbwell.com/4_0_0/StructureDefinition/observation-lab-is-core',
                valueBoolean: true
            });
        });

        test('emits a repeated diagnostic report once with its result references', () => {
            const reports = mapPanel().resources.filter(
                (r) => r.resourceType === 'DiagnosticReport'
            );

            expect(reports).toHaveLength(1);
            expect(reports[0]).toMatchObject({
                status: 'final',
                issued: '2026-01-03T01:00:00+00:00',
                effectiveDateTime: '2026-01-03T00:00:00+00:00',
                result: [
                    { reference: 'Observation/obs-glucose' },
                    { reference: 'Observation/obs-sodium' }
                ]
            });
        });

        test('falls back to a string value when the result is not a number', () => {
            const { resources } = mapOne(
                'vital_summary_document',
                resourceSection({
                    references: ['Observation/obs-bp-systolic', 'Observation/obs-bp-diastolic'],
                    rows: [
                        row('Vital Name', 'Blood Pressure'),
                        row('effectiveDateTime', '2026-01-01T00:00:00+00:00'),
                        row('valueString', '120/80')
                    ]
                })
            );

            expect(resources[0].valueString).toBe('120/80');
            expect(resources[0].valueQuantity).toBeUndefined();
            expect(resources[0].derivedFrom).toHaveLength(2);
        });

        test('uses a string value and drops the unit when the quantity value is not numeric', () => {
            const { resources } = mapOne(
                'lab_summary_document',
                resourceSection({
                    references: ['Observation/obs-1'],
                    rows: [
                        row('valueQuantity.value', 'Positive'),
                        row('valueQuantity.unit', 'mg/dL')
                    ]
                })
            );

            expect(resources[0].valueString).toBe('Positive');
            expect(resources[0].valueQuantity).toBeUndefined();
        });
    });

    describe('pregnancy episode', () => {
        test('maps the episode to a Condition without using the section-type code', () => {
            const { resources } = mapOne(
                'pregnancy_episode_document',
                resourceSection({
                    references: ['Condition/cond-pregnancy'],
                    code: {
                        coding: [
                            {
                                system: 'https://www.icanbwell.com/section-type',
                                code: 'episode-info'
                            }
                        ]
                    },
                    rows: [
                        row('Episode Start Date', '2026-01-10'),
                        row('Estimated Delivery Date', '2026-09-19'),
                        row('Current Trimester', '2nd trimester')
                    ]
                })
            );

            expect(resources[0]).toMatchObject({
                resourceType: 'Condition',
                code: { text: 'Synthetic summary' },
                onsetDateTime: '2026-01-10'
            });
            expect(resources[0].code.coding).toBeUndefined();
            expect(resources[0].text.div).toContain('2nd trimester');
        });
    });

    describe('dispatch and reporting', () => {
        test('skips a composition type it does not know and names it in the report', () => {
            const mapper = new CompositionResourceMapper();

            const { resources, report } = mapper.mapComposition(
                composition('brand_new_document', [
                    resourceSection({ references: ['Condition/cond-1'] })
                ])
            );

            expect(resources).toEqual([]);
            expect(report.skippedCompositionTypes).toEqual(['brand_new_document']);
        });

        test('reports a referenced resource type the domain has no mapping for', () => {
            const { resources, report } = mapOne(
                'encounter_summary_document',
                resourceSection({ references: ['Appointment/appt-1'] })
            );

            expect(resources).toEqual([]);
            expect(report.unmappedResourceTypes).toEqual(['Appointment']);
        });

        test('reports required fields the composition did not supply', () => {
            const { report } = mapOne(
                'procedure_summary_document',
                resourceSection({ references: ['Procedure/proc-1'] })
            );

            expect(report.missingRequired).toContainEqual({
                resourceType: 'Procedure',
                field: 'status'
            });
        });

        test('never puts a row value in the report', () => {
            const { report } = mapOne(
                'condition_summary_document',
                resourceSection({
                    references: ['Condition/cond-1'],
                    rows: [row('Onset Date', 'secret-value'), row('Brand New Row', 'secret-value')]
                })
            );

            expect(JSON.stringify(report)).not.toContain('secret-value');
        });
    });

    describe('mapToBundle', () => {
        test('returns a collection bundle with one urn:uuid entry per resource', () => {
            const mapper = new CompositionResourceMapper();
            const conditions = composition('condition_summary_document', [
                resourceSection({ references: ['Condition/cond-1'] })
            ]);
            const procedures = composition('procedure_summary_document', [
                resourceSection({ references: ['Procedure/proc-1'] })
            ]);

            const { bundle } = mapper.mapToBundle([conditions, procedures]);

            expect(bundle.resourceType).toBe('Bundle');
            expect(bundle.type).toBe('collection');
            expect(bundle.entry.map((e) => e.resource.resourceType)).toEqual([
                'Condition',
                'Procedure'
            ]);
            for (const entry of bundle.entry) {
                expect(entry.fullUrl).toBe(`urn:uuid:${entry.resource.id}`);
            }
        });
    });

    describe('contract with the composition service golden outputs', () => {
        const fixtures = loadFixtureCompositions();

        test('loads the golden compositions', () => {
            expect(fixtures.length).toBeGreaterThanOrEqual(22);
        });

        test.each(fixtures.map((f) => [f.name, f.resource.type.coding[0].code, f.resource]))(
            '%s (%s) maps with no unknown rows, types or unparsed values',
            (_name, _typeCode, resource) => {
                const mapper = new CompositionResourceMapper();

                const { resources, report } = mapper.mapComposition(resource);

                expect(report.skippedCompositionTypes).toEqual([]);
                expect(report.unmappedResourceTypes).toEqual([]);
                expect(report.unknownRows).toEqual([]);
                expect(report.unparsedRows).toEqual([]);
                expect(resources.length).toBeGreaterThan(0);
                for (const mapped of resources) {
                    expect(mapped.id).toEqual(expect.any(String));
                    expect(mapped.text.div).toMatch(
                        /^<div xmlns="http:\/\/www.w3.org\/1999\/xhtml">/
                    );
                }
            }
        );
    });
});
