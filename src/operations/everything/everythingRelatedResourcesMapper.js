
/**
 * @typedef {Object} EverythingRelatedResourceFields
 * @property {string} uuid - Path to reach the resource uuid field
 * @property {string} sourceId - Path to reach resource sourceId field
 * @typedef {Object} EverythingRelatedResources
 * @property {string} type - The name of the related resource.
 * @property {string | undefined} params Search param for the target
 * @property {string} indexHintName - Index hint to use for the query on the related resource, if applicable
 * @property {{
 *      query: string,
 *      requiredValues: string,
 *      fieldForParentLookup: string[],
 *      includeProxyPatient: boolean|undefined
 *      proxyPatientQuery: string|undefined
 *      proxyPatientRequiredValues: string[]|undefined
 *  } | undefined
 *  } customQuery custom query for the target
 */

/**
 * @type {{[k: string]:Array<EverythingRelatedResources>}}
 */
const RelatedResourceMap = {
    Patient: [
        {
            type: "Account",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "AdverseEvent",
            params: "subject={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "AllergyIntolerance",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "Appointment",
            params: "patient={ref}",
            indexHintName: "participantActorUuid_uuid"
        },
        {
            type: "AppointmentResponse",
            params: "patient={ref}",
            indexHintName: "actorUuid_uuid"
        },
        {
            type: "BiologicallyDerivedProduct",
            customQuery: {
                query: `{"collection.source._uuid":"{resourceType}/{_uuid}"}`,
                requiredValues: ["resourceType", "_uuid"],
                fieldForParentLookup: "collection.source",
                includeProxyPatient: true,
                proxyPatientQuery: `{"collection.source.{idType}":"{resourceType}/{id}"}`,
                proxyPatientRequiredValues: ["resourceType", "id", "idType"]
            },
            indexHintName: "collectionSourceUuid_uuid"
        },
        {
            type: "Basic",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "BodyStructure",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "CarePlan",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "CareTeam",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "ChargeItem",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Claim",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "ClaimResponse",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "ClinicalImpression",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Communication",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "CommunicationRequest",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Composition",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Condition",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Consent",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "Contract",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Coverage",
            params: "patient={ref}",
            indexHintName: "helix_coverage_uuid"
        },
        {
            type: "CoverageEligibilityRequest",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "CoverageEligibilityResponse",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "DetectedIssue",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "Device",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "DeviceRequest",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "DeviceUseStatement",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "DiagnosticReport",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "DocumentManifest",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "DocumentReference",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Encounter",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "EnrollmentRequest",
            params: "patient={ref}",
            indexHintName: "candidateUuid_uuid"
        },
        {
            type: "EpisodeOfCare",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "ExplanationOfBenefit",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "FamilyMemberHistory",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "Flag",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Goal",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Group",
            params: "member={ref}",
            indexHintName: "memberEntityUuid_uuid"
        },
        {
            type: "GuidanceResponse",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "ImagingStudy",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Immunization",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "ImmunizationEvaluation",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "ImmunizationRecommendation",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "Invoice",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Linkage",
            params: "item={ref}"
            // indexHintName: ""
        },
        {
            type: "List",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "MeasureReport",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Media",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "MedicationAdministration",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "MedicationDispense",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "MedicationRequest",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "MedicationStatement",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "MolecularSequence",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "NutritionOrder",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "Observation",
            params: "patient={ref}",
            indexHintName: "subject__uuid._uuid.effectiveDateTime-1"
        },
        {
            type: "Patient",
            params: "link={ref}",
            indexHintName: "link.other._uuid_1"
        },
        {
            type: "PaymentNotice",
            params: "request={ref}"
            // indexHintName: ""
        },
        {
            type: "Person",
            params: "patient={ref}",
            indexHintName: "linkTarget_uuid_uuid"
        },
        {
            type: "Procedure",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Provenance",
            params: "patient={ref}",
            indexHintName: "targetUuid_uuid"
        },
        {
            type: "QuestionnaireResponse",
            params: "patient={ref}",
            indexHintName: "consent_graphql_1"
        },
        {
            type: "RelatedPerson",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "RequestGroup",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "ResearchSubject",
            params: "patient={ref}",
            indexHintName: "individualUuid_uuid"
        },
        {
            type: "RiskAssessment",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Schedule",
            params: "actor={ref}",
            indexHintName: "actor.reference_uuid"
        },
        {
            type: "ServiceRequest",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Specimen",
            params: "patient={ref}",
            indexHintName: "subjectUuid_uuid"
        },
        {
            type: "Subscription",
            customQuery: {
                query: `{"$and":[{"extension":{"$elemMatch":{"url":"https://icanbwell.com/codes/source_patient_id","valueString":"{_sourceId}"}}},{"extension":{"$elemMatch":{"url":"https://icanbwell.com/codes/service_slug","valueString":"{_sourceAssigningAuthority}"}}}]}`,
                requiredValues: ["_sourceId", "_sourceAssigningAuthority"],
                fieldForParentLookup: "extension"
            },
            indexHintName: "extension.url_1_extension.valueString_1_uuid_1"
        },
        {
            type: "SubscriptionStatus",
            customQuery: {
                query: `{"$and":[{"extension":{"$elemMatch":{"url":"https://icanbwell.com/codes/source_patient_id","valueString":"{_sourceId}"}}},{"extension":{"$elemMatch":{"url":"https://icanbwell.com/codes/service_slug","valueString":"{_sourceAssigningAuthority}"}}}]}`,
                requiredValues: ["_sourceId", "_sourceAssigningAuthority"],
                fieldForParentLookup: "extension"
            },
            indexHintName: "extension.url_1_extension.valueString_1_uuid_1"
        },
        {
            type: "SubscriptionTopic",
            customQuery: {
                query: `{"$and":[{"identifier":{"$elemMatch":{"system":"https://icanbwell.com/codes/source_patient_id","value":"{_sourceId}"}}},{"identifier":{"$elemMatch":{"system":"https://icanbwell.com/codes/service_slug","value":"{_sourceAssigningAuthority}"}}}]}`,
                requiredValues: ["_sourceId", "_sourceAssigningAuthority"],
                fieldForParentLookup: "identifier"
            },
            indexHintName: "identifier.system_1_identifier.value_1_uuid_1"
        },
        {
            type: "SupplyDelivery",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        },
        {
            type: "SupplyRequest",
            params: "requester={ref}",
            indexHintName: "requesterUuid_uuid"
        },
        {
            type: "Task",
            params: "patient={ref}",
            indexHintName: "for_uuid_uuid"
        },
        {
            type: "VisionPrescription",
            params: "patient={ref}",
            indexHintName: "patientUuid_uuid"
        }
    ]
}

class EverythingRelatedResourcesMapper {
    constructor() { }

    /**
     * Retrieves related resources for the given resource type.
     *
     * if specificReltedResourceTypeSet is not passed, return mapper for all the resources
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