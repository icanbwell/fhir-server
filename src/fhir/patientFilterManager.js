class PatientFilterManager {
    constructor() {
        /**
         * defines the field in each resource that links to patient
         * @type {Object}
         */
        this.patientFilterMapping = {
            Annotation: 'authorReference.reference',
            Signature: 'who.reference',
            Account: 'subject.reference',
            AdverseEvent: 'subject.reference',
            AllergyIntolerance: 'patient.reference',
            Appointment: 'participant.actor.reference',
            AppointmentResponse: 'actor.reference',
            AuditEvent: 'agent.who.reference',
            Basic: 'subject.reference',
            BiologicallyDerivedProduct: 'collection.source.reference',
            BodyStructure: 'patient.reference',
            CarePlan: 'subject.reference',
            CareTeam: 'subject.reference',
            ChargeItem: 'subject.reference',
            Claim: 'patient.reference',
            ClaimResponse: 'patient.reference',
            ClinicalImpression: 'subject.reference',
            Communication: 'subject.reference',
            CommunicationRequest: 'subject.reference',
            Composition: 'subject.reference',
            Condition: 'subject.reference',
            Consent: 'patient.reference',
            Contract: 'subject.reference',
            Coverage: 'beneficiary.reference',
            CoverageEligibilityRequest: 'patient.reference',
            CoverageEligibilityResponse: 'patient.reference',
            DetectedIssue: 'patient.reference',
            Device: 'patient.reference',
            DeviceRequest: 'subject.reference',
            DeviceUseStatement: 'subject.reference',
            DiagnosticReport: 'subject.reference',
            DocumentManifest: 'subject.reference',
            DocumentReference: 'subject.reference',
            Encounter: 'subject.reference',
            EnrollmentRequest: 'candidate.reference',
            EpisodeOfCare: 'patient.reference',
            ExplanationOfBenefit: 'patient.reference',
            FamilyMemberHistory: 'patient.reference',
            Flag: 'subject.reference',
            Goal: 'subject.reference',
            Group: 'member.entity.reference',
            GuidanceResponse: 'subject.reference',
            ImagingStudy: 'subject.reference',
            Immunization: 'patient.reference',
            ImmunizationEvaluation: 'patient.reference',
            ImmunizationRecommendation: 'patient.reference',
            Invoice: 'subject.reference',
            List: 'subject.reference',
            MeasureReport: 'subject.reference',
            Media: 'subject.reference',
            MedicationAdministration: 'subject.reference',
            MedicationDispense: 'subject.reference',
            MedicationRequest: 'subject.reference',
            MedicationStatement: 'subject.reference',
            MolecularSequence: 'patient.reference',
            NutritionOrder: 'patient.reference',
            Observation: 'subject.reference',
            Patient: 'id',
            Person: 'link.target.reference',
            Procedure: 'subject.reference',
            Provenance: 'target.reference',
            QuestionnaireResponse: 'subject.reference',
            RelatedPerson: 'patient.reference',
            RequestGroup: 'subject.reference',
            ResearchSubject: 'individual.reference',
            RiskAssessment: 'subject.reference',
            Schedule: 'actor.reference',
            ServiceRequest: 'subject.reference',
            Specimen: 'subject.reference',
            SupplyDelivery: 'patient.reference',
            SupplyRequest: 'requester.reference',
            Task: 'for.reference',
            VisionPrescription: 'patient.reference'
        };
        /**
         * defines resources that don't have patient data
         * @type {string[]}
         */
        this.resourcesWithoutPatientData = [
            'Practitioner',
            'PractitionerRole',
            'Organization',
            'Medication',
            'CodeSystem',
            'Library',
            'PlanDefinition',
            'GuidanceResponse',
            'Measure',
            'Location',
            'HealthcareService',
            'InsurancePlan',
            'Binary',
            'ValueSet'
        ];
    }

    /**
     * @param {string} resourceType
     * @return {string|string[]|null}
     */
    getPatientPropertyForResource({resourceType}) {
        return this.patientFilterMapping[`${resourceType}`];
    }

    /**
     * Returns whether access is allowed to the specified resource with patient scope
     * @param {string} resourceType
     * @returns {boolean}
     */
    canAccessResourceWithPatientScope({resourceType}) {
        return Object.hasOwn(this.patientFilterMapping, resourceType) ||
            this.resourcesWithoutPatientData.includes(resourceType);
    }
}

module.exports = {
    PatientFilterManager
};
