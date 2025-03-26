
/**
 * @typedef {Object} EverythingRelatedResourceFields
 * @property {string} uuid - Path to reach the resource uuid field
 * @property {string} sourceId - Path to reach resource sourceId field
 * @typedef {Object} EverythingRelatedResources
 * @property {string} type - The name of the related resource.
 * @property {string} params Search param for the target
 */

/**
 * TODO: correct the format
 * @type {{[k: string]:Array<EverythingRelatedResources>}}
 */
const RelatedResourceMap = {
    Patient: [
        {
            type: "Account",
            params: "patient={ref}"
        },
        {
            type: "AdverseEvent",
            params: "subject={ref}"
        },
        {
            type: "AllergyIntolerance",
            params: "patient={ref}"
        },
        {
            type: "Appointment",
            params: "patient={ref}"
        },
        {
            type: "AppointmentResponse",
            params: "patient={ref}"
        },
        {
            type: "Basic",
            params: "patient={ref}"
        },
        {
            type: "BodyStructure",
            params: "patient={ref}"
        },
        {
            type: "CarePlan",
            params: "patient={ref}"
        },
        {
            type: "CareTeam",
            params: "patient={ref}"
        },
        {
            type: "ChargeItem",
            params: "patient={ref}"
        },
        {
            type: "Claim",
            params: "patient={ref}"
        },
        {
            type: "ClaimResponse",
            params: "patient={ref}"
        },
        {
            type: "ClinicalImpression",
            params: "patient={ref}"
        },
        {
            type: "Communication",
            params: "patient={ref}"
        },
        {
            type: "CommunicationRequest",
            params: "patient={ref}"
        },
        {
            type: "Composition",
            params: "patient={ref}"
        },
        {
            type: "Condition",
            params: "patient={ref}"
        },
        {
            type: "Consent",
            params: "patient={ref}"
        },
        {
            type: "Contract",
            params: "patient={ref}"
        },
        {
            type: "Coverage",
            params: "patient={ref}"
        },
        {
            type: "CoverageEligibilityRequest",
            params: "patient={ref}"
        },
        {
            type: "CoverageEligibilityResponse",
            params: "patient={ref}"
        },
        {
            type: "DetectedIssue",
            params: "patient={ref}"
        },
        {
            type: "Device",
            params: "patient={ref}"
        },
        {
            type: "DeviceRequest",
            params: "patient={ref}"
        },
        {
            type: "DeviceUseStatement",
            params: "patient={ref}"
        },
        {
            type: "DiagnosticReport",
            params: "patient={ref}"
        },
        {
            type: "DocumentManifest",
            params: "patient={ref}"
        },
        {
            type: "DocumentReference",
            params: "patient={ref}"
        },
        {
            type: "Encounter",
            params: "patient={ref}"
        },
        {
            type: "EnrollmentRequest",
            params: "patient={ref}"
        },
        {
            type: "EpisodeOfCare",
            params: "patient={ref}"
        },
        {
            type: "ExplanationOfBenefit",
            params: "patient={ref}"
        },
        {
            type: "FamilyMemberHistory",
            params: "patient={ref}"
        },
        {
            type: "Flag",
            params: "patient={ref}"
        },
        {
            type: "Goal",
            params: "patient={ref}"
        },
        {
            type: "Group",
            params: "member={ref}"
        },
        {
            type: "GuidanceResponse",
            params: "patient={ref}"
        },
        {
            type: "ImagingStudy",
            params: "patient={ref}"
        },
        {
            type: "Immunization",
            params: "patient={ref}"
        },
        {
            type: "ImmunizationEvaluation",
            params: "patient={ref}"
        },
        {
            type: "ImmunizationRecommendation",
            params: "patient={ref}"
        },
        {
            type: "Invoice",
            params: "patient={ref}"
        },
        {
            type: "Linkage",
            params: "item={ref}"
        },
        {
            type: "List",
            params: "patient={ref}"
        },
        {
            type: "MeasureReport",
            params: "patient={ref}"
        },
        {
            type: "Media",
            params: "patient={ref}"
        },
        {
            type: "MedicationAdministration",
            params: "patient={ref}"
        },
        {
            type: "MedicationDispense",
            params: "patient={ref}"
        },
        {
            type: "MedicationRequest",
            params: "patient={ref}"
        },
        {
            type: "MedicationStatement",
            params: "patient={ref}"
        },
        {
            type: "MolecularSequence",
            params: "patient={ref}"
        },
        {
            type: "NutritionOrder",
            params: "patient={ref}"
        },
        {
            type: "Observation",
            params: "patient={ref}"
        },
        {
            type: "Patient",
            params: "link={ref}"
        },
        {
            type: "PaymentNotice",
            params: "request={ref}"
        },
        {
            type: "Person",
            params: "patient={ref}"
        },
        {
            type: "Procedure",
            params: "patient={ref}"
        },
        {
            type: "Provenance",
            params: "patient={ref}"
        },
        {
            type: "QuestionnaireResponse",
            params: "patient={ref}"
        },
        {
            type: "RelatedPerson",
            params: "patient={ref}"
        },
        {
            type: "RequestGroup",
            params: "patient={ref}"
        },
        {
            type: "ResearchSubject",
            params: "patient={ref}"
        },
        {
            type: "RiskAssessment",
            params: "patient={ref}"
        },
        {
            type: "Schedule",
            params: "actor={ref}"
        },
        {
            type: "ServiceRequest",
            params: "patient={ref}"
        },
        {
            type: "Specimen",
            params: "patient={ref}"
        },
        {
            type: "Subscription",
            params: "extension=https://icanbwell.com/codes/source_patient_id|{id}"
        },
        {
            type: "SubscriptionStatus",
            params: "extension=https://icanbwell.com/codes/source_patient_id|{id}"
        },
        {
            type: "SubscriptionTopic",
            params: "identifier=https://icanbwell.com/codes/source_patient_id|{id}"
        },
        {
            type: "SupplyDelivery",
            params: "patient={ref}"
        },
        {
            type: "SupplyRequest",
            params: "requester={ref}"
        },
        {
            type: "Task",
            params: "patient={ref}"
        },
        {
            type: "VisionPrescription",
            params: "patient={ref}"
        }
    ]
}

class EverythingRelatedResourcesMapper {
    constructor() { }

    /**
     * Retrieves related resources for the given resource type.
     *
     * @param {string} resourceType - The type of resource to retrieve related resources for.
     * @param {Set<string> | null} specificReltedResourceTypeSet - Return only passed realted resource type map
     * @returns {Array<EverythingRelatedResources>} - An array of related resource map.
     */
    relatedResources(resourceType, specificReltedResourceTypeSet) {
        if (!RelatedResourceMap[resourceType]) {
            throw new Error(`EverythingRelatedResourcesMapper doesn't support ${resourceType} resource`)
        }

        let result = RelatedResourceMap[resourceType] || [];

        if (specificReltedResourceTypeSet) {
            result = result.filter((v) => specificReltedResourceTypeSet.has(v.type))
        }

        return result;
    }

}

module.exports = { EverythingRelatedResourcesMapper }