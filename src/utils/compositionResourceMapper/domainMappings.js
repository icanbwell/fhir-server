/**
 * Row-to-field tables for each summary Composition the composition service writes.
 *
 * A resource spec says how one referenced resource type is rebuilt:
 *   subjectField       where Composition.subject goes ('subject' or 'patient')
 *   applyCode          writes the section's CodeableConcept onto the resource
 *   rows               row title -> setter; a title missing here is reported as unknown
 *   finalize           builds fields that need more than one row
 *   required           R4 1..* fields, checked after mapping and reported when absent
 *   sourceField        native field for the source references; a b.well extension otherwise
 *   idFromEntry        the section references the resource itself, so its id is reused
 *   copySectionExtensions  carries the section's extensions onto the resource
 *
 * @typedef {Object} ResourceSpec
 */

const { parseDecimal, toCodeForm } = require('./rowValues');
const {
    setPath,
    narrativeOnly,
    text,
    textIfAbsent,
    dateTime,
    instant,
    code,
    codedConcept,
    bool,
    stash,
    sameAsDisplay
} = require('./fieldSetters');

const SYSTEMS = {
    actCode: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
    allergyClinical: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
    allergyVerification: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
    conditionClinical: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
    interpretation: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
    npi: 'http://hl7.org/fhir/sid/us-npi',
    observationCategory: 'http://terminology.hl7.org/CodeSystem/observation-category'
};

const VACCINE_CODE_SYSTEMS = {
    CVX: 'http://hl7.org/fhir/sid/cvx',
    NDC: 'http://hl7.org/fhir/sid/ndc'
};

const INTERPRETATION_CODES = {
    high: 'H',
    low: 'L',
    normal: 'N',
    abnormal: 'A',
    'critical-high': 'HH',
    'critical-low': 'LL'
};

const REACTION_SEVERITIES = new Set(['mild', 'moderate', 'severe']);

const REFERENCE_PATTERN = /^[A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$/;

/**
 * @param {string} field
 * @returns {(resource: Object, concept: Object) => void}
 */
const conceptTo = (field) => (resource, concept) => {
    if (resource[field] === undefined) {
        resource[field] = concept;
    }
};

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitList(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/** @type {ResourceSpec} */
const condition = {
    subjectField: 'subject',
    applyCode: conceptTo('code'),
    required: ['subject'],
    rows: {
        'Condition Name': text('code', 'text'),
        'Symptom Name': text('code', 'text'),
        Category: text('category', 0, 'text'),
        'Onset Date': dateTime('onsetDateTime'),
        'When Reported': dateTime('recordedDate'),
        Status: codedConcept(
            ['clinicalStatus'],
            SYSTEMS.conditionClinical,
            sameAsDisplay(['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'])
        ),
        'Last Confirmed Date': narrativeOnly,
        'How It Was Noted': narrativeOnly,
        'Is Chronic': narrativeOnly,
        Source: narrativeOnly
    }
};

/** @type {ResourceSpec} */
const pregnancyEpisode = {
    subjectField: 'subject',
    // The section code is a b.well section type, not a clinical code, so it is not carried.
    applyCode: (resource, _concept, composition) => {
        if (composition.title) {
            resource.code = { text: composition.title };
        }
    },
    required: ['subject'],
    rows: {
        'Episode Start Date': dateTime('onsetDateTime'),
        'Episode Sequence': narrativeOnly,
        'Is Pregnant': narrativeOnly,
        'Estimated Delivery Date': narrativeOnly,
        'Current Trimester': narrativeOnly,
        'Episode Duration Days': narrativeOnly
    }
};

/** @type {ResourceSpec} */
const procedure = {
    subjectField: 'subject',
    applyCode: conceptTo('code'),
    required: ['status', 'subject'],
    rows: {
        'Procedure Name': text('code', 'text'),
        'Procedure Type': text('category', 'text'),
        'Performed Date': dateTime('performedDateTime'),
        Status: code(
            ['status'],
            [
                'preparation',
                'in-progress',
                'not-done',
                'on-hold',
                'stopped',
                'completed',
                'entered-in-error',
                'unknown'
            ]
        ),
        'Latest Reason': text('reasonCode', 0, 'text'),
        Performer: text('performer', 0, 'actor', 'display'),
        'Latest Location': text('location', 'display'),
        'Latest Outcome': text('outcome', 'text'),
        'Body Site': text('bodySite', 0, 'text'),
        'Latest Note': text('note', 0, 'text'),
        'Procedure Count': narrativeOnly,
        Source: narrativeOnly
    }
};

/** @type {ResourceSpec} */
const allergyIntolerance = {
    subjectField: 'patient',
    applyCode: conceptTo('code'),
    required: ['patient'],
    rows: {
        'Allergen Name': text('code', 'text'),
        Criticality: code(['criticality'], ['low', 'high', 'unable-to-assess']),
        Category: code(['category', 0], ['food', 'medication', 'environment', 'biologic']),
        'Clinical Status': codedConcept(
            ['clinicalStatus'],
            SYSTEMS.allergyClinical,
            sameAsDisplay(['active', 'inactive', 'resolved'])
        ),
        'Verification Status': codedConcept(
            ['verificationStatus'],
            SYSTEMS.allergyVerification,
            sameAsDisplay(['unconfirmed', 'confirmed', 'refuted', 'entered-in-error'])
        ),
        'Recorded Date': dateTime('recordedDate'),
        Onset: dateTime('onsetDateTime'),
        Recorder: text('recorder', 'display'),
        Severity: (_resource, value, scratch) => {
            const severity = toCodeForm(value);
            if (!REACTION_SEVERITIES.has(severity)) {
                return false;
            }
            scratch.severity = severity;
        },
        Reaction: stash('reaction'),
        Source: narrativeOnly
    },
    // reaction.manifestation is 1..*, so a severity alone cannot form a reaction.
    finalize: (resource, scratch) => {
        if (scratch.reaction) {
            resource.reaction = [{ manifestation: [{ text: scratch.reaction }] }];
            if (scratch.severity) {
                resource.reaction[0].severity = scratch.severity;
            }
        }
    }
};

/** @type {ResourceSpec} */
const immunization = {
    subjectField: 'patient',
    applyCode: conceptTo('vaccineCode'),
    required: ['status', 'vaccineCode', 'patient', 'occurrence[x]'],
    rows: {
        'Immunization Name': text('vaccineCode', 'text'),
        'Vaccine Code Type': stash('vaccineCodeType'),
        'Vaccine Code': stash('vaccineCode'),
        occurrenceDateTime: dateTime('occurrenceDateTime'),
        Status: code(['status'], ['completed', 'entered-in-error', 'not-done']),
        Performer: text('performer', 0, 'actor', 'display'),
        'Location Administered': text('location', 'display'),
        'Primary Source': bool('primarySource'),
        'Documented Vaccine Dose': text('protocolApplied', 0, 'doseNumberString'),
        Reason: text('reasonCode', 0, 'text'),
        'Vaccine Group': narrativeOnly,
        'Vaccine Name': narrativeOnly,
        'Dose Count': narrativeOnly,
        Source: narrativeOnly
    },
    finalize: (resource, scratch) => {
        const system = VACCINE_CODE_SYSTEMS[(scratch.vaccineCodeType || '').toUpperCase()];
        if (!system || !scratch.vaccineCode) {
            return;
        }
        const codings = resource.vaccineCode?.coding ?? [];
        if (!codings.some((c) => c.system === system && c.code === scratch.vaccineCode)) {
            setPath(
                resource,
                ['vaccineCode', 'coding'],
                [...codings, { system, code: scratch.vaccineCode }]
            );
        }
    }
};

/** @type {ResourceSpec} */
const encounter = {
    subjectField: 'subject',
    // The section code holds the class (v3 ActCode) next to the visit type codings.
    applyCode: (resource, concept) => {
        if (resource.class !== undefined || resource.type !== undefined) {
            return;
        }
        const codings = concept.coding ?? [];
        const classCoding = codings.find((c) => c.system === SYSTEMS.actCode);
        const typeCodings = codings.filter((c) => c !== classCoding);
        if (classCoding) {
            resource.class = classCoding;
        }
        if (typeCodings.length > 0) {
            resource.type = [{ coding: typeCodings }];
        }
    },
    required: ['status', 'class'],
    rows: {
        'Visit Status': code(
            ['status'],
            [
                'planned',
                'arrived',
                'triaged',
                'in-progress',
                'onleave',
                'finished',
                'cancelled',
                'entered-in-error',
                'unknown'
            ]
        ),
        Class: textIfAbsent('class', 'display'),
        Type: textIfAbsent('type', 0, 'text'),
        'Visit Type': textIfAbsent('type', 0, 'text'),
        Date: dateTime('period', 'start'),
        Reason: text('reasonCode', 0, 'text'),
        Provider: text('participant', 0, 'individual', 'display'),
        Practitioner: text('participant', 0, 'individual', 'display'),
        'Practitioner NPI': (resource, value) => {
            setPath(resource, ['participant', 0, 'individual', 'identifier'], {
                system: SYSTEMS.npi,
                value
            });
        },
        Service: text('serviceType', 'text'),
        Facility: text('serviceProvider', 'display'),
        'Managed By': textIfAbsent('serviceProvider', 'display'),
        'Location Name': text('location', 0, 'location', 'display'),
        'Primary Location': textIfAbsent('location', 0, 'location', 'display'),
        'Location Status': code(
            ['location', 0, 'status'],
            ['planned', 'active', 'reserved', 'completed']
        ),
        'Visit Name': narrativeOnly,
        'Care Setting': narrativeOnly,
        'Reason Code': narrativeOnly,
        Specialty: narrativeOnly,
        Location: narrativeOnly,
        'Location Phone': narrativeOnly,
        Source: narrativeOnly
    },
    // Encounter.location.location is 1..1, so a status alone cannot form a location.
    finalize: (resource) => {
        if (resource.location) {
            resource.location = resource.location.filter((l) => l.location);
            if (resource.location.length === 0) {
                delete resource.location;
            }
        }
    }
};

/** @type {ResourceSpec} */
const carePlan = {
    subjectField: 'subject',
    applyCode: (resource, concept) => {
        if (resource.category === undefined) {
            resource.category = [concept];
        }
    },
    required: ['status', 'intent', 'subject'],
    rows: {
        'CarePlan Name': text('title'),
        'Plan Type': text('category', 0, 'text'),
        status: code(
            ['status'],
            ['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown']
        ),
        'period.start': dateTime('period', 'start'),
        'period.end': dateTime('period', 'end'),
        created: dateTime('created'),
        'Plan Details': text('description'),
        'Most Recent Date': narrativeOnly,
        Source: narrativeOnly
    }
};

/** @type {ResourceSpec} */
const documentReference = {
    subjectField: 'subject',
    applyCode: conceptTo('type'),
    required: ['status', 'content'],
    rows: {
        Type: text('type', 'text'),
        Date: instant('date'),
        Status: code(['status'], ['current', 'superseded', 'entered-in-error'])
    }
};

/** @type {ResourceSpec} */
const medicationStatement = {
    subjectField: 'subject',
    applyCode: conceptTo('medicationCodeableConcept'),
    required: ['status', 'medication[x]', 'subject'],
    idFromEntry: true,
    rows: {
        'Medication Name': text('medicationCodeableConcept', 'text'),
        'MedicationRequest ID': (resource, value) => {
            resource.derivedFrom = splitList(value).map((id) => ({
                reference: `MedicationRequest/${id}`,
                type: 'MedicationRequest'
            }));
        },
        Status: code(
            ['status'],
            [
                'active',
                'completed',
                'entered-in-error',
                'intended',
                'stopped',
                'on-hold',
                'unknown',
                'not-taken'
            ]
        ),
        'Authored On Date': dateTime('dateAsserted'),
        Prescriber: text('informationSource', 'display'),
        Source: narrativeOnly
    }
};

/** @type {ResourceSpec} */
const observation = {
    subjectField: 'subject',
    applyCode: conceptTo('code'),
    required: ['status', 'code'],
    sourceField: 'derivedFrom',
    copySectionExtensions: true,
    rows: {
        'Labs Name': text('code', 'text'),
        'Vital Name': text('code', 'text'),
        'Effective Date': dateTime('effectiveDateTime'),
        effectiveDateTime: dateTime('effectiveDateTime'),
        Category: codedConcept(
            ['category', 0],
            SYSTEMS.observationCategory,
            sameAsDisplay([
                'social-history',
                'vital-signs',
                'imaging',
                'laboratory',
                'procedure',
                'survey',
                'exam',
                'therapy',
                'activity'
            ])
        ),
        'Result Status': code(
            ['status'],
            [
                'registered',
                'preliminary',
                'final',
                'amended',
                'corrected',
                'cancelled',
                'entered-in-error',
                'unknown'
            ]
        ),
        'Interpreted By': text('performer', 0, 'display'),
        'valueQuantity.value': (resource, value) => {
            const parsed = parseDecimal(value);
            if (parsed === undefined) {
                resource.valueString = value;
            } else {
                setPath(resource, ['valueQuantity', 'value'], parsed);
            }
        },
        'valueQuantity.unit': text('valueQuantity', 'unit'),
        valueString: text('valueString'),
        Interpretation: codedConcept(
            ['interpretation', 0],
            SYSTEMS.interpretation,
            INTERPRETATION_CODES
        ),
        Analyte: narrativeOnly,
        Source: narrativeOnly
    },
    // value[x] holds one value, and a Quantity needs its number.
    finalize: (resource) => {
        if (
            resource.valueString !== undefined ||
            typeof resource.valueQuantity?.value !== 'number'
        ) {
            delete resource.valueQuantity;
        }
    }
};

/** @type {ResourceSpec} */
const diagnosticReport = {
    subjectField: 'subject',
    applyCode: conceptTo('code'),
    required: ['status', 'code'],
    rows: {
        Status: code(
            ['status'],
            [
                'registered',
                'partial',
                'preliminary',
                'final',
                'amended',
                'corrected',
                'appended',
                'cancelled',
                'entered-in-error',
                'unknown'
            ]
        ),
        Issued: instant('issued'),
        Effective: dateTime('effectiveDateTime'),
        Result: (resource, value) => {
            const references = splitList(value);
            if (references.length === 0 || !references.every((r) => REFERENCE_PATTERN.test(r))) {
                return false;
            }
            resource.result = references.map((reference) => ({ reference }));
        }
    }
};

/**
 * Composition type code -> referenced resource type -> spec.
 * @type {Object<string, Object<string, ResourceSpec>>}
 */
const DOMAIN_MAPPINGS = {
    allergyintolerance_summary_document: { AllergyIntolerance: allergyIntolerance },
    careplan_summary_document: { CarePlan: carePlan },
    condition_summary_document: { Condition: condition },
    document_summary_document: { DocumentReference: documentReference },
    encounter_summary_document: { Encounter: encounter },
    immunization_summary_document: { Immunization: immunization },
    medication_summary_document: { MedicationStatement: medicationStatement },
    lab_summary_document: { Observation: observation, DiagnosticReport: diagnosticReport },
    vital_summary_document: { Observation: observation },
    pregnancy_episode_document: { Condition: pregnancyEpisode },
    procedure_summary_document: { Procedure: procedure }
};

module.exports = {
    DOMAIN_MAPPINGS
};
