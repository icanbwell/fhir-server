# FHIR $everything endpoint

The FHIR server supports the $everything endpoint of the FHIR specification (https://www.hl7.org/fhir/resource-operation-graph.html). This operation is used to retrieve all resources related to the provided resource. The $everything operation internally uses graphs to fetch or delete all the resources. Here are the graphs that $everything uses underneath: https://github.com/icanbwell/fhir-server/tree/main/src/graphs

It is mandatory to provide `id` either in search query parameter or in path parameter.
For example:

-   <base_url>/4_0_0/Patient/<patient1>/$everything
-   <base_url>/4_0_0/Patient/$everything?id=<patient1>

Sample $everything result for patient

```
{
  "entry": [
    {
      "id": "patient1",
      "resource": {
        "resourceType": "Patient",
        "id": "patient1"
        // <rest of resource fields>
      }
    },
    {
      "id": "example",
      "resource": {
        "resourceType": "Account",
        "id": "example"
        // <rest of resource fields>
      }
    },
    {
      "id": "2354-InAgeCohort",
      "resource": {
        "resourceType": "Observation",
        "id": "2354-InAgeCohort"
        // <rest of resource fields>
      }
    },
    {
      "id": "person2",
      "resource": {
        "resourceType": "Person",
        "id": "person2"
        // <rest of resource fields>
      }
    },
    {
      "id": "personTopLevel",
      "resource": {
        "resourceType": "Person",
        "id": "personTopLevel"
        // <rest of resource fields>
      }
    }
    // rest of resources
  ],
  "resourceType": "Bundle",
  "type": "searchset",
  "timestamp": "2023-12-20T03:31:07.077Z",
  "total": 4,
  "link": [
    {
      "relation": "self",
      "url": "<base_url>/4_0_0/Patient/patient1/$everything"
    }
  ]
}
```

## Resources supported by $everything

### Practitioner

URL: <base_url>/4_0_0/Practitioner/<practitioner_id>/$everything

Resources returned/deleted:
Practitioner, PractitionerRole, Organization, Location, HealthcareService, InsurancePlan

### Organization

URL: <base_url>/4_0_0/Organization/<organization_id>/$everything

Resources returned/deleted:
Organization, Location, HealthcareService, OrganizationAffiliation

### Slot

URL: <base_url>/4_0_0/Slot/<slot_id>/$everything

Resources returned/deleted:
Slot, Schedule, PractitionerRole, Practitioner

### Person

URL: <base_url>/4_0_0/Person/<person_id>/$everything

Resources returned/deleted:
Person, Patient, Account, AdverseEvent, AllergyIntolerance, Appointment, AppointmentResponse, Basic, BodyStructure, CarePlan, CareTeam, ChargeItem, Claim, ClaimResponse, ClinicalImpression, Communication, CommunicationRequest, Composition, Condition, Consent, Contract, Coverage, CoverageEligibilityRequest, CoverageEligibilityResponse, DetectedIssue, Device, DeviceRequest, DeviceUseStatement, DiagnosticReport, DocumentManifest, DocumentReference, Encounter, EnrollmentRequest, EpisodeOfCare, ExplanationOfBenefit, FamilyMemberHistory, Flag, Goal, Group, GuidanceResponse, ImagingStudy, Immunization, ImmunizationEvaluation, ImmunizationRecommendation, Invoice, List, MeasureReport, Media, MedicationAdministration, MedicationDispense, MedicationRequest, MedicationStatement, MolecularSequence, NutritionOrder, Observation, Patient, Person, Procedure, Provenance, QuestionnaireResponse, RelatedPerson, RequestGroup, ResearchSubject, RiskAssessment, Schedule, ServiceRequest, Specimen, SupplyDelivery, SupplyRequest, Task, VisionPrescription

### Patient

URL: <base_url>/4_0_0/Patient/<patient_id>/$everything

Resources returned/deleted:
Patient, Account, AdverseEvent, AllergyIntolerance, Appointment, AppointmentResponse, Basic, BodyStructure, CarePlan, CareTeam, ChargeItem, Claim, ClaimResponse, ClinicalImpression, Communication, CommunicationRequest, Composition, Condition, Consent, Contract, Coverage, CoverageEligibilityRequest, CoverageEligibilityResponse, DetectedIssue, Device, DeviceRequest, DeviceUseStatement, DiagnosticReport, DocumentManifest, DocumentReference, Encounter, EnrollmentRequest, EpisodeOfCare, ExplanationOfBenefit, FamilyMemberHistory, Flag, Goal, Group, GuidanceResponse, ImagingStudy, Immunization, ImmunizationEvaluation, ImmunizationRecommendation, Invoice, List, MeasureReport, Media, MedicationAdministration, MedicationDispense, MedicationRequest, MedicationStatement, MolecularSequence, NutritionOrder, Observation, Patient, Person, Procedure, Provenance, QuestionnaireResponse, RelatedPerson, RequestGroup, ResearchSubject, RiskAssessment, Schedule, ServiceRequest, Specimen, SupplyDelivery, SupplyRequest, Task, VisionPrescription

## Supported search query parameters

### id

It can be used if data related to more than one resource provided needs to be fetched. If `id` search query parameter is passed, then the path parameter is ignored.

For example: <base_url>/4_0_0/Patient/$everything?id=patient1,patient2

### contained

By default, the FHIR returns all the related resources in the top level bundle.  
However if you pass the `contained` search query parameter then the FHIR server will put the related resources in a `contained` field under each resource.

For example: <base_url>/4_0_0/Patient/<patient1>/$everything?contained=true

```
{
    "entry": [
        {
            "id": "patient1",
            "resource": {
                "resourceType": "Patient",
                "id": "patient1",
                // <rest of resource fields>
                "contained": [
                    {
                        "id": "example",
                        "resource": {
                            "resourceType": "Account",
                            "id": "example"
                            // <rest of resource fields>
                        }
                    },
                    {
                        "id": "2354-InAgeCohort",
                        "resource": {
                            "resourceType": "Observation",
                            "id": "2354-InAgeCohort"
                            // <rest of resource fields>
                        }
                    },
                    {
                        "id": "person2",
                        "resource": {
                            "resourceType": "Person",
                            "id": "person2"
                            // <rest of resource fields>
                        }
                    },
                    {
                        "id": "personTopLevel",
                        "resource": {
                            "resourceType": "Person",
                            "id": "personTopLevel"
                            // <rest of resource fields>
                        }
                    }
                    // rest of resources
                ]
            }
        }
    ],
    "resourceType": "Bundle",
    "type": "searchset",
    "timestamp": "2023-12-20T03:31:07.077Z",
    "total": 4,
    "link": [
        {
            "relation": "self",
            "url": "<base_url>/4_0_0/Patient/patient1/$everything?contained=true"
        }
    ]
}
```

### \_debug

The `_debug` parameter is used to get debugging information with the result.

For example: <base_url>/4_0_0/Patient/<patient1>/$everything?\_debug=true

### \_explain

The `_explain` parameter is used to explain the query made by everything operation. When `_explain` parameter is passed, all resources are not returned but one of each type of resource is returned.

For example: <base_url>/4_0_0/Organization/<organization1>/$everything?\_explain=true

### \_type

This parameter can be used to narrow down the result of resources to the provided list of resources.

For example: <base_url>/4_0_0/Patient/<patient1>/$everything?\_type=Person,Account,Observation

Note:
When `_type` parameter is used then the `contained` parameter is ignored.

### \_includeNonClinicalResources

This parameter is used to find all linked non-clinical resources. It can only be used with Patient and Person resources and in GET request only. Default depth for which linked non-clinical resources can be fetched is 1 and it can be configured using `_nonClinicalResourcesDepth` parameter.
When used along with `_type`, the result of only top level resources will be narrowed and it will not affect linked non-clinical resources.

For example: <base_url>/4_0_0/Patient/<patient_id>/$everything?\_includeNonClinicalResources=true

### \_nonClinicalResourcesDepth

This parameter is used to define depth for which linked non-clinical resources needs to be fetched. The parameter is optional with default value of 1. And its maximum value can be 3 as more depth will make request very slow.

For example: <base_url>/4_0_0/Patient/<patient_id>/$everything?\_includeNonClinicalResources=true&\_nonClinicalResourcesDepth=3
