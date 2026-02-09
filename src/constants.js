/**
 * @name exports
 * @summary Some constants used throughout the app
 */
module.exports = {
    CLIENT: 'client',
    CLIENT_DB: 'client_db',
    AUDIT_EVENT_CLIENT: 'auditEventClient',
    AUDIT_EVENT_CLIENT_DB: 'auditEventClient_db',
    DB_SEARCH_LIMIT: 100,
    DB_SEARCH_LIMIT_FOR_IDS: 1000,
    COLLECTION: {
        ACCOUNT: 'Account',
        ACTIVITYDEFINITION: 'ActivityDefinition',
        ADMINISTRABLEPRODUCTDEFINITION: 'AdministrableProductDefinition',
        ADVERSEEVENT: 'AdverseEvent',
        ALLERGYINTOLERANCE: 'AllergyIntolerance',
        APPOINTMENT: 'Appointment',
        APPOINTMENTRESPONSE: 'AppointmentResponse',
        AUDITEVENT: 'AuditEvent',
        BASIC: 'Basic',
        BINARY: 'Binary',
        BIOLOGICALLYDERIVEDPRODUCT: 'BiologicallyDerivedProduct',
        BODYSTRUCTURE: 'BodyStructure',
        BUNDLE: 'Bundle',
        CAPABILITYSTATEMENT: 'CapabilityStatement',
        CAREPLAN: 'CarePlan',
        CARETEAM: 'CareTeam',
        CATALOGENTRY: 'CatalogEntry',
        CHARGEITEM: 'ChargeItem',
        CHARGEITEMDEFINITION: 'ChargeItemDefinition',
        CITATION: 'Citation',
        CLAIM: 'Claim',
        CLAIMRESPONSE: 'ClaimResponse',
        CLINICALIMPRESSION: 'ClinicalImpression',
        CLINICALUSEDEFINITION: 'ClinicalUseDefinition',
        CODESYSTEM: 'CodeSystem',
        COMMUNICATION: 'Communication',
        COMMUNICATIONREQUEST: 'CommunicationRequest',
        COMPARTMENTDEFINITION: 'CompartmentDefinition',
        COMPOSITION: 'Composition',
        CONCEPTMAP: 'ConceptMap',
        CONDITION: 'Condition',
        CONSENT: 'Consent',
        CONTRACT: 'Contract',
        COVERAGE: 'Coverage',
        COVERAGEELIGIBILITYREQUEST: 'CoverageEligibilityRequest',
        COVERAGEELIGIBILITYRESPONSE: 'CoverageEligibilityResponse',
        DETECTEDISSUE: 'DetectedIssue',
        DEVICE: 'Device',
        DEVICEDEFINITION: 'DeviceDefinition',
        DEVICEMETRIC: 'DeviceMetric',
        DEVICEREQUEST: 'DeviceRequest',
        DEVICEUSESTATEMENT: 'DeviceUseStatement',
        DIAGNOSTICREPORT: 'DiagnosticReport',
        DOCUMENTMANIFEST: 'DocumentManifest',
        DOCUMENTREFERENCE: 'DocumentReference',
        ENCOUNTER: 'Encounter',
        ENDPOINT: 'Endpoint',
        ENROLLMENTREQUEST: 'EnrollmentRequest',
        ENROLLMENTRESPONSE: 'EnrollmentResponse',
        EPISODEOFCARE: 'EpisodeOfCare',
        EVENTDEFINITION: 'EventDefinition',
        EVIDENCE: 'Evidence',
        EVIDENCEREPORT: 'EvidenceReport',
        EVIDENCEVARIABLE: 'EvidenceVariable',
        EXAMPLESCENARIO: 'ExampleScenario',
        EXPLANATIONOFBENEFIT: 'ExplanationOfBenefit',
        FAMILYMEMBERHISTORY: 'FamilyMemberHistory',
        FLAG: 'Flag',
        GOAL: 'Goal',
        GRAPHDEFINITION: 'GraphDefinition',
        GROUP: 'Group',
        GUIDANCERESPONSE: 'GuidanceResponse',
        HEALTHCARESERVICE: 'HealthcareService',
        IMAGINGSTUDY: 'ImagingStudy',
        IMMUNIZATION: 'Immunization',
        IMMUNIZATIONEVALUATION: 'ImmunizationEvaluation',
        IMMUNIZATIONRECOMMENDATION: 'ImmunizationRecommendation',
        IMPLEMENTATIONGUIDE: 'ImplementationGuide',
        INGREDIENT: 'Ingredient',
        INSURANCEPLAN: 'InsurancePlan',
        INVOICE: 'Invoice',
        LIBRARY: 'Library',
        LINKAGE: 'Linkage',
        LIST: 'List',
        LOCATION: 'Location',
        MANUFACTUREDITEMDEFINITION: 'ManufacturedItemDefinition',
        MEASURE: 'Measure',
        MEASUREREPORT: 'MeasureReport',
        MEDIA: 'Media',
        MEDICATION: 'Medication',
        MEDICATIONADMINISTRATION: 'MedicationAdministration',
        MEDICATIONDISPENSE: 'MedicationDispense',
        MEDICATIONKNOWLEDGE: 'MedicationKnowledge',
        MEDICATIONREQUEST: 'MedicationRequest',
        MEDICATIONSTATEMENT: 'MedicationStatement',
        MEDICINALPRODUCTDEFINITION: 'MedicinalProductDefinition',
        MESSAGEDEFINITION: 'MessageDefinition',
        MESSAGEHEADER: 'MessageHeader',
        MOLECULARSEQUENCE: 'MolecularSequence',
        NAMINGSYSTEM: 'NamingSystem',
        NUTRITIONORDER: 'NutritionOrder',
        NUTRITIONPRODUCT: 'NutritionProduct',
        OBSERVATION: 'Observation',
        OBSERVATIONDEFINITION: 'ObservationDefinition',
        OPERATIONDEFINITION: 'OperationDefinition',
        OPERATIONOUTCOME: 'OperationOutcome',
        ORGANIZATION: 'Organization',
        ORGANIZATIONAFFILIATION: 'OrganizationAffiliation',
        PACKAGEDPRODUCTDEFINITION: 'PackagedProductDefinition',
        PATIENT: 'Patient',
        PAYMENTNOTICE: 'PaymentNotice',
        PAYMENTRECONCILIATION: 'PaymentReconciliation',
        PERSON: 'Person',
        PLANDEFINITION: 'PlanDefinition',
        PRACTITIONER: 'Practitioner',
        PRACTITIONERROLE: 'PractitionerRole',
        PROCEDURE: 'Procedure',
        PROVENANCE: 'Provenance',
        QUESTIONNAIRE: 'Questionnaire',
        QUESTIONNAIRERESPONSE: 'QuestionnaireResponse',
        REGULATEDAUTHORIZATION: 'RegulatedAuthorization',
        RELATEDPERSON: 'RelatedPerson',
        REQUESTGROUP: 'RequestGroup',
        RESEARCHDEFINITION: 'ResearchDefinition',
        RESEARCHELEMENTDEFINITION: 'ResearchElementDefinition',
        RESEARCHSTUDY: 'ResearchStudy',
        RESEARCHSUBJECT: 'ResearchSubject',
        RISKASSESSMENT: 'RiskAssessment',
        SCHEDULE: 'Schedule',
        SEARCHPARAMETER: 'SearchParameter',
        SERVICEREQUEST: 'ServiceRequest',
        SLOT: 'Slot',
        SPECIMEN: 'Specimen',
        SPECIMENDEFINITION: 'SpecimenDefinition',
        STRUCTUREDEFINITION: 'StructureDefinition',
        STRUCTUREMAP: 'StructureMap',
        SUBSCRIPTION: 'Subscription',
        SUBSCRIPTIONSTATUS: 'SubscriptionStatus',
        SUBSCRIPTIONTOPIC: 'SubscriptionTopic',
        SUBSTANCE: 'Substance',
        SUBSTANCEDEFINITION: 'SubstanceDefinition',
        SUPPLYDELIVERY: 'SupplyDelivery',
        SUPPLYREQUEST: 'SupplyRequest',
        TASK: 'Task',
        TERMINOLOGYCAPABILITIES: 'TerminologyCapabilities',
        TESTREPORT: 'TestReport',
        TESTSCRIPT: 'TestScript',
        VALUESET: 'ValueSet',
        VERIFICATIONRESULT: 'VerificationResult',
        VISIONPRESCRIPTION: 'VisionPrescription'
    },
    EVERYTHING_OP_NON_CLINICAL_RESOURCE_DEPTH: 3,
    HTTP_CONTEXT_KEYS: {
        LINKED_PATIENTS_FOR_PERSON_PREFIX: 'linkedPatientIdsFor-',
        PERSON_OWNER_PREFIX: 'personOwnerFor-',
        CONSENTED_PROA_DATA_ACCESSED: 'consentedProaDataAccessed'
    },
    LENIENT_SEARCH_HANDLING: 'lenient',
    STRICT_SEARCH_HANDLING: 'strict',
    SPECIFIED_QUERY_PARAMS: [
        '_explain', '_debug', '_validate', 'contained', '_hash_references', 'base_version', '_elements',
        '_useAccessIndex', 'active', '_source', '_id', 'onset-date', '_lastUpdated',
        'source', 'id', 'onset_date', '_bundle', '_sort', '_count', '_useTwoStepOptimization', 'extension',
        '_cursorBatchSize', '_setIndexHint', '_total', '_getpagesoffset', 'resource', '_streamResponse', 'remove',
        'streamResponse', 'team', '_text', '_content', '_list', '_has', '_type', '_include', '_revinclude',
        '_summary', '_contained', '_containedType', '_query', '_filter', '_format', '_pretty', 'role', 'member',
        'onBehalfOf', 'period', 'practitionerId', 'patientId', '_prefer', '_rewritePatientReference', '_keepOldUI',
        '_includeNonClinicalResources', '_nonClinicalResourcesDepth', '_includePatientLinkedOnly', '_includeUuidOnly'
    ],
    REQUEST_ID_HEADER: 'x-request-id',
    REGEX: {
        INSTANT: /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$/,
        // allows upper and lowercase ASCII letters, numerals, "-" and "." only.
        ID_FIELD: /^[A-Za-z0-9\-.]+$/
    },
    KAFKA_CONNECTION_HEALTHCHECK_INTERVAL: 30000, // In milliseconds,
    REFERENCE_EXTENSION_DATA_MAP: {
        display: {
            id: 'referenceDisplay',
            url: 'https://www.icanbwell.com/referenceDisplay',
            valueKey: 'valueString'
        },
        type: {
            id: 'referenceType',
            url: 'https://www.icanbwell.com/referenceType',
            valueKey: 'valueUri'
        }
    },
    GRIDFS: {
        INSERT: 'INSERT',
        RETRIEVE: 'RETRIEVE',
        DELETE: 'DELETE'
    },
    PATIENT_INITIATED_CONNECTION: [
        'proa'
    ],
    REQUEST_ID_TYPE: {
        USER_REQUEST_ID: 'userRequestId',
        SYSTEM_GENERATED_REQUEST_ID: 'systemGeneratedRequestId'
    },
    RESPONSE_NONCE: 'responseNonce',
    ACCESS_LOGS_COLLECTION_NAME: 'access-logs',
    ACCESS_LOGS_ENTRY_DATA: 'access-logs-entry-data',
    PATIENT_REFERENCE_PREFIX: 'Patient/',
    PERSON_REFERENCE_PREFIX: 'Person/',
    PERSON_PROXY_PREFIX: 'person.',
    BWELL_PERSON_SOURCE_ASSIGNING_AUTHORITY: 'bwell',
    PROXY_PERSON_CONSENT_CODING: {
        SYSTEM: 'http://terminology.hl7.org/3.1.0/CodeSystem-v3-RoleCode.html',
        CODE: 'AUT'
    },
    RESOURCE_RESTRICTION_TAG: {
        SYSTEM: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
        CODE: 'R'
    },
    RESOURCE_HIDDEN_TAG: {
        SYSTEM: 'https://fhir.icanbwell.com/4_0_0/CodeSystem/server-behavior',
        CODE: 'hidden'
    },
    CONSENT_OF_LINKED_PERSON_INDEX: 'consent_of_linked_person',
    EXTERNAL_REQUEST_RETRY_COUNT: 3,
    DEFAULT_CACHE_MAX_COUNT: 25,
    DEFAULT_CACHE_EXPIRY_TIME: 24 * 60 * 60 * 1000,
    USER_INFO_CACHE_EXPIRY_TIME: 5 * 60 * 1000, // 5 mins
    OPERATIONS: {
        READ: 'READ',
        WRITE: 'WRITE',
        DELETE: 'DELETE'
    },
    EXPORTSTATUS_LAST_UPDATED_DEFAULT_TIME: 24 * 60 * 60 * 1000, // 24hrs
    BULK_EXPORT_EVENT_STATUS_MAP: {
        accepted: 'ExportInitiated',
        completed: 'ExportCompleted',
        'in-progress': 'ExportStatusUpdated',
        'entered-in-error': 'ExportCompleted'
    },
    SUBSCRIPTION_RESOURCES_REFERENCE_FIELDS: ['extension', 'identifier'],
    SUBSCRIPTION_RESOURCES_REFERENCE_SYSTEM: {
        patient: 'https://icanbwell.com/codes/source_patient_id',
        person: 'https://icanbwell.com/codes/client_person_id'
    },
    SUBSCRIPTION_RESOURCES_REFERENCE_KEY_MAP: {
        extension: {
            key: 'url',
            value: 'valueString'
        },
        identifier: {
            key: 'system',
            value: 'value'
        }
    },
    RESOURCE_CLOUD_STORAGE_PATH_KEY: '_ref',
    HISTORY_MIGRATION_LAST_UPDATED_DEFAULT_TIME: 60 * 60 * 1000, // 1hr
    CLOUD_STORAGE_CLIENTS: {
        S3_CLIENT: "S3Client"
    },
    CONSENT_CATEGORY: {
        DATA_CONNECTION_VIEW_CONTROL: {
            SYSTEM: "http://www.icanbwell.com/consent-category",
            CODE: "dataConnectionViewControl"
        }
    },
    MONGO_ERROR: {
        RESOURCE_SIZE_EXCEEDS: 'Document is larger than the maximum size 16777216'
    },
    STREAM_ACCESS_LOG_BODY_LIMIT: 100,
    CLOUD_EVENT: {
        SOURCE: 'https://www.icanbwell.com/fhir-server'
    },
    CACHE_STATUS: {
        HIT: 'Hit',
        MISS: 'Miss'
    }
};
