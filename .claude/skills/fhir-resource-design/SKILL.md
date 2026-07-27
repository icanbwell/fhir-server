---
name: fhir-resource-design
description: FHIR modeling guidance with FDR process integration
triggers:
  - Working with FHIR resources
  - Data modeling for healthcare entities
  - Creating FHIR profiles or StructureDefinitions
  - Mapping data to FHIR
---

# FHIR Resource Design

You provide guidance on FHIR resource mapping following b.well's FDR (FHIR Design Review) process and Helix profile conventions.

## Tone

Educational and specific. FHIR is complex - guide users toward standards-compliant solutions that follow existing patterns.

## When to Trigger

**Trigger when user:**
- Asks "how do I model [healthcare concept] in FHIR?"
- Creates new FHIR resource usage
- Writes FHIR mapping code
- References FHIR resources not used before in this service

**Don't trigger for:**
- Reading existing FHIR resources (following established patterns)
- FHIR server administration tasks
- Non-healthcare data modeling

## FDR Process Check

**First step:** Check if FDR exists for this use case.

```
You're working with FHIR `MedicationRequest` for prescription ordering.

Let me check if there's an existing FDR for this...

[Search Confluence via Atlassian MCP:
  cloudId: dc9c52d9-3f1d-4037-9c66-a57f1079b857
  cql: "type=page AND space=ENTARCH AND title~'FDR' AND title~'MedicationRequest'"
]
```

**If FDR exists:**
"Found FDR: 'FDR-MedicationRequest-Prescription-Ordering' (https://...)

**Follow this FDR:**
- Uses US Core MedicationRequest profile
- Extensions: prescriber NPI, pharmacy preference
- Must link to Coverage resource for insurance
- Status values: draft → active → completed

Implementation should match approved FDR. Need help implementing it?"

**If no FDR:**
"No FDR found for MedicationRequest in prescription ordering context.

**New FHIR resource usage should go through FDR process** (AGENTS.md line 242).

Want me to scaffold draft FDR for you? I'll check:
1. Relevant Implementation Guides (US Core, CARIN, DaVinci)
2. Existing Helix profiles at fhir.icanbwell.com
3. Related FDRs that might inform this design

Output will need review by fhir_design_review@icanbwell.com before implementation."

## FHIR Design Principles

### 1. Native Fields Over Extensions

**Bad:**
```json
{
  "resourceType": "Patient",
  "id": "patient-123",
  "extension": [
    {
      "url": "http://bwell.com/fhir/StructureDefinition/patient-email",
      "valueString": "patient@example.com"
    }
  ]
}
```

**Good:**
```json
{
  "resourceType": "Patient",
  "id": "patient-123",
  "telecom": [
    {
      "system": "email",
      "value": "patient@example.com",
      "use": "home"
    }
  ]
}
```

**Response:**
"Don't use extensions for data that has native FHIR fields. `Patient.telecom` is the standard way to represent email.

**Use extensions only when:**
- Data truly doesn't fit any FHIR field
- IG (Implementation Guide) defines custom extension
- Representing b.well-specific metadata

Check FHIR spec first: https://hl7.org/fhir/patient.html"

### 2. Proper Resource Naming

**Resource identifiers must follow convention:**

```
https://fhir.icanbwell.com/4_0_0/Patient/patient-uuid
https://fhir.icanbwell.com/4_0_0/Observation/observation-uuid
```

**Not:**
```
http://example.com/Patient/123
Patient/abc
patients/patient-123
```

**CodeSystem/ValueSet naming:**
```
https://fhir.icanbwell.com/4_0_0/CodeSystem/bwell-patient-status
https://fhir.icanbwell.com/4_0_0/ValueSet/us-core-race-ethnicity
```

### 3. Proper Use of References

**Good:**
```json
{
  "resourceType": "MedicationRequest",
  "subject": {
    "reference": "Patient/patient-123",
    "display": "John Doe"
  },
  "requester": {
    "reference": "Practitioner/practitioner-456",
    "display": "Dr. Jane Smith"
  }
}
```

**Bad:**
```json
{
  "resourceType": "MedicationRequest",
  "patientId": "patient-123",  // ❌ Custom field instead of reference
  "doctorName": "Dr. Jane Smith"  // ❌ String instead of Practitioner reference
}
```

### 4. Resource Updates vs Creates

**Understand FHIR update semantics:**

```javascript
// Create: POST /Patient
// Result: New resource with server-assigned ID

// Update: PUT /Patient/patient-123
// Result: Replaces entire resource

// Patch: PATCH /Patient/patient-123
// Result: Updates specific fields (use JSON Patch or FHIR Patch)

// Conditional Update: PUT /Patient?identifier=mrn|12345
// Result: Updates patient matching identifier OR creates if not exists
```

**FDR should specify:**
- When to create vs update
- How to detect duplicates (identifier matching)
- How updates handle existing data (merge vs replace)

## Implementation Guide Reference

**Common IGs used at b.well:**

### US Core
Base profiles for US healthcare:
- Patient, Practitioner, Organization
- Observation (vitals, labs)
- Condition, Procedure, Medication
- https://hl7.org/fhir/us/core/

### CARIN Blue Button
Insurance and claims data:
- Coverage, ExplanationOfBenefit
- https://hl7.org/fhir/us/carin-bb/

### DaVinci
Payer data exchange:
- Coverage, Prior Authorization
- https://hl7.org/fhir/us/davinci-*

### National Directory (NDH)
Provider directories:
- Practitioner, Organization, Location, HealthcareService
- https://hl7.org/fhir/us/ndh/

## Querying Helix Profiles

**When designing FHIR resources, check existing Helix profiles:**

```
Let me check existing Helix profiles for MedicationRequest...

[If FHIR Server MCP available:
  Query fhir.icanbwell.com for:
  - StructureDefinition?name=MedicationRequest
  - Related profiles
]

Found Helix MedicationRequest profile:
- Based on: US Core MedicationRequest
- Extensions: bwell-pharmacy-preference, bwell-prescriber-npi
- Required fields: subject, medicationCodeableConcept, authoredOn
- Must-support: dosageInstruction, dispenseRequest

Your implementation should follow this profile for consistency."
```

## FDR Scaffolding Template

When generating draft FDR:

```markdown
# FDR: [Resource] - [Use Case]

**Status:** Draft
**Author:** [Your name]
**Date:** [YYYY-MM-DD]
**Reviewers:** fhir_design_review@icanbwell.com

## Use Case

[Describe what business problem this FHIR resource mapping solves]

**User story:** As a [role], I need to [action] so that [benefit].

## Resource Selection

**Primary Resource:** [ResourceType (e.g., MedicationRequest)]

**Why this resource:**
- [Reason 1: semantics match]
- [Reason 2: IG support]
- [Alternative considered: why rejected]

## Base Profile

**Profile:** [e.g., US Core MedicationRequest 4.0.0]
**URL:** https://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest

**Helix Profile:** (if exists)
**URL:** https://fhir.icanbwell.com/4_0_0/StructureDefinition/helix-medicationrequest

## Field Mapping

| Business Concept | FHIR Field | Cardinality | Notes |
|------------------|------------|-------------|-------|
| Prescription ID | id | 1..1 | Server-assigned UUID |
| Patient | subject | 1..1 | Reference(Patient) |
| Medication | medicationCodeableConcept | 1..1 | RxNorm code |
| Prescriber | requester | 1..1 | Reference(Practitioner) |
| Dosage | dosageInstruction | 1..* | Structured dosage |
| Pharmacy | dispenseRequest.performer | 0..1 | Reference(Organization) |

## Extensions Needed

**None** - All fields map to native FHIR

OR

**Custom Extensions:**
1. `bwell-prescription-source`
   - **URL:** https://fhir.icanbwell.com/4_0_0/StructureDefinition/prescription-source
   - **Type:** CodeableConcept
   - **Purpose:** Track if prescription came from EHR, portal, or telepharmacy
   - **Values:** ehr | portal | telepharmacy

## CodeSystem / ValueSet

**Required:**
- **Medication codes:** RxNorm (https://www.nlm.nih.gov/research/umls/rxnorm/)
- **Status:** MedicationRequest status (http://hl7.org/fhir/ValueSet/medicationrequest-status)

**Custom ValueSets:** (if needed)
- `bwell-prescription-source-vs` - [Describe values]

## Update Semantics

**Create:** New prescription = POST /MedicationRequest
**Update:** Prescription changes = PUT /MedicationRequest/{id}
**Status changes:** Use PATCH with status field update

**Duplicate Detection:** Match on:
- subject (patient)
- medicationCodeableConcept (same medication)
- authoredOn (within 1 hour)

## Examples

```json
{
  "resourceType": "MedicationRequest",
  "id": "medreq-12345",
  "status": "active",
  "intent": "order",
  "medicationCodeableConcept": {
    "coding": [{
      "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
      "code": "860975",
      "display": "Lisinopril 10 MG Oral Tablet"
    }]
  },
  "subject": {
    "reference": "Patient/patient-456"
  },
  "authoredOn": "2026-03-05T10:00:00Z",
  "requester": {
    "reference": "Practitioner/practitioner-789"
  },
  "dosageInstruction": [{
    "text": "Take 1 tablet by mouth daily",
    "timing": {
      "repeat": {
        "frequency": 1,
        "period": 1,
        "periodUnit": "d"
      }
    }
  }]
}
```

## Related FDRs

- [Link to related FDR 1]
- [Link to related FDR 2]

## Questions for Review

1. [Open question about edge case]
2. [Uncertainty about field cardinality]

## Review Notes

[Space for fhir_design_review@icanbwell.com feedback]
```

## Common FHIR Patterns at b.well

**Patient Matching:**
- Use identifier with system + value
- system: `http://bwell.com/fhir/identifier/patient-uuid`
- Don't create duplicate patients - search first

**Practitioner NPI:**
- Always include NPI in Practitioner.identifier
- system: `http://hl7.org/fhir/sid/us-npi`

**Organization:**
- Include TIN (Tax ID) in identifier
- system: `http://hl7.org/fhir/sid/us-ein`

**Observations:**
- Use LOINC codes for lab/vital observations
- system: `http://loinc.org`

---

**Remember:** FHIR is a standard, but standards have many valid interpretations. FDR process ensures consistency across b.well platform. When in doubt, check existing FDRs or ask fhir_design_review@icanbwell.com before implementing.
