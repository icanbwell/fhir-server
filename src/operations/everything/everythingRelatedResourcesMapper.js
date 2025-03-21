
/**
 * @typedef {Object} EverythingRelatedResourceFields
 * @property {string} uuid - Path to reach the resource uuid field
 * @property {string} sourceId - Path to reach resource sourceId field
 * @typedef {Object} EverythingRelatedResources
 * @property {string} type - The name of the related resource.
 * @property {EverythingRelatedResourceFields} fields - The fields associated with the resource.
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
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "AdverseEvent",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "AllergyIntolerance",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "Appointment",
            fields: {
                uuid: "participant.actor._uuid",
                sourceId: "participant.actor._sourceId"
            }
        },
        {
            resourceName: "AppointmentResponse",
            fields: {
                uuid: "actor._uuid",
                sourceId: "actor._sourceId"
            }
        },
        {
            resourceName: "Basic",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "BodyStructure",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "CarePlan",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "CareTeam",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "ChargeItem",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Claim",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "ClaimResponse",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "ClinicalImpression",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Communication",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "CommunicationRequest",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Composition",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Condition",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Consent",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "Contract",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Coverage",
            fields: {
                uuid: "beneficiary._uuid",
                sourceId: "beneficiary._sourceId"
            }
        },
        {
            resourceName: "CoverageEligibilityRequest",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "CoverageEligibilityResponse",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "DetectedIssue",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "Device",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "DeviceRequest",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "DeviceUseStatement",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "DiagnosticReport",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "DocumentManifest",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "DocumentReference",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Encounter",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "EnrollmentRequest",
            fields: {
                uuid: "candidate._uuid",
                sourceId: "candidate._sourceId"
            }
        },
        {
            resourceName: "EpisodeOfCare",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "ExplanationOfBenefit",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "FamilyMemberHistory",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "Flag",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Goal",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Group",
            fields: {
                uuid: "member.entity._uuid",
                sourceId: "member.entity._sourceId"
            }
        },
        {
            resourceName: "GuidanceResponse",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "ImagingStudy",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Immunization",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "ImmunizationEvaluation",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "ImmunizationRecommendation",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "Invoice",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Linkage",
            fields: {
                uuid: "item.resource._uuid",
                sourceId: "item.resource._sourceId"
            }
        },
        {
            resourceName: "List",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "MeasureReport",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Media",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "MedicationAdministration",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "MedicationDispense",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "MedicationRequest",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "MedicationStatement",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "MolecularSequence",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "NutritionOrder",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "Observation",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            type: "Patient",
            params: "link={ref}",
            fields: {
                uuid: "link.other._uuid",
                sourceId: "link.other._sourceId"
            }
        },
        {
            resourceName: "PaymentNotice",
            fields: {
                uuid: "request._uuid",
                sourceId: "request._sourceId"
            }
        },
        {
            resourceName: "Person",
            fields: {
                uuid: "link.target._uuid",
                sourceId: "link.target._sourceId"
            }
        },
        {
            resourceName: "Procedure",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Provenance",
            fields: {
                uuid: "target._uuid",
                sourceId: "target._sourceId"
            }
        },
        {
            resourceName: "QuestionnaireResponse",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "RelatedPerson",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "RequestGroup",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "ResearchSubject",
            fields: {
                uuid: "individual._uuid",
                sourceId: "individual._sourceId"
            }
        },
        {
            resourceName: "RiskAssessment",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Schedule",
            fields: {
                uuid: "actor._uuid",
                sourceId: "actor._sourceId"
            }
        },
        {
            resourceName: "ServiceRequest",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "Specimen",
            fields: {
                uuid: "subject._uuid",
                sourceId: "subject._sourceId"
            }
        },
        {
            resourceName: "SupplyDelivery",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        },
        {
            resourceName: "SupplyRequest",
            fields: {
                uuid: "requester._uuid",
                sourceId: "requester._sourceId"
            }
        },
        {
            resourceName: "Task",
            fields: {
                uuid: "for._uuid",
                sourceId: "for._sourceId"
            }
        },
        {
            resourceName: "VisionPrescription",
            fields: {
                uuid: "patient._uuid",
                sourceId: "patient._sourceId"
            }
        }
    ]
}

class EverythingRelatedResourcesMapper {
    constructor() { }

    /**
     * Retrieves related resources for the given resource type.
     *
     * @param {string} resourceType - The type of resource to retrieve related resources for.
     * @param {string[] | null} specificReltedResourceType - Return only passed realted resource type map
     * @returns {Array<EverythingRelatedResources>} - An array of related resource map.
     */
    relatedResources(resourceType, specificReltedResourceType) {
        const specificReltedResourceTypeSet = specificReltedResourceType ? new Set(specificReltedResourceType) : null
        if (!RelatedResourceMap[resourceType]) {
            throw new Error(`EverythingRelatedResourcesMapper doesn't support ${resourceType} resource`)
        }

        let result = RelatedResourceMap[resourceType] || [];

        if (specificReltedResourceType) {
            result = result.filter((v) => specificReltedResourceTypeSet.has(v.resourceName))
        }

        return RelatedResourceMap[resourceType];
    }

}

module.exports = { EverythingRelatedResourcesMapper }