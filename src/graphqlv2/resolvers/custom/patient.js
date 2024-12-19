module.exports = {
    Patient: {
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        account: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Account'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        adverseEvent: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    subject: `Patient/${parent.id}`
                },
                context,
                info,
                'AdverseEvent'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        allergyIntolerance: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'AllergyIntolerance'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        appointment: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Appointment'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        appointmentResponse: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'AppointmentResponse'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        basic: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Basic'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        bodyStructure: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'BodyStructure'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        carePlan: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'CarePlan'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        careTeam: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'CareTeam'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        chargeItem: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ChargeItem'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        claim: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Claim'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        claimResponse: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ClaimResponse'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        clinicalImpression: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ClinicalImpression'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        communicationV2: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Communication'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        communicationRequest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'CommunicationRequest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        composition: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Composition'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        condition: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Condition'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        consent: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Consent'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        contract: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Contract'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        coverage: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    beneficiary: `Patient/${parent.id}`
                },
                context,
                info,
                'Coverage'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        coverageEligibilityRequest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'CoverageEligibilityRequest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        coverageEligibilityResponse: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'CoverageEligibilityResponse'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        detectedIssue: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'DetectedIssue'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        device: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Device'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        deviceRequest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'DeviceRequest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        deviceUseStatement: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'DeviceUseStatement'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        diagnosticReport: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'DiagnosticReport'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        documentManifest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'DocumentManifest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        documentReference: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'DocumentReference'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        encounter: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Encounter'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        enrollmentRequest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'EnrollmentRequest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        episodeOfCare: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'EpisodeOfCare'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        explanationOfBenefit: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ExplanationOfBenefit'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        familyMemberHistory: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'FamilyMemberHistory'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        flag: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Flag'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        goal: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Goal'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        group: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    member: `Patient/${parent.id}`
                },
                context,
                info,
                'Group'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        guidanceResponse: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'GuidanceResponse'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        imagingStudy: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ImagingStudy'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        immunization: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Immunization'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        immunizationEvaluation: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ImmunizationEvaluation'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        immunizationRecommendation: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ImmunizationRecommendation'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        invoice: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Invoice'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        list: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'List'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        measureReport: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'MeasureReport'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        media: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Media'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        medicationAdministration: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'MedicationAdministration'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        medicationDispense: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'MedicationDispense'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        medicationRequest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'MedicationRequest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        medicationStatement: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'MedicationStatement'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        molecularSequence: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'MolecularSequence'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        nutritionOrder: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'NutritionOrder'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        observation: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Observation'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        person: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    link: `Patient/${parent.id}`
                },
                context,
                info,
                'Person'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        procedure: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Procedure'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        provenance: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Provenance'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        questionnaireResponse: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'QuestionnaireResponse'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        relatedPerson: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'RelatedPerson'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        requestGroup: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'RequestGroup'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        researchSubject: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ResearchSubject'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        riskAssessment: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'RiskAssessment'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        schedule: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    actor: `Patient/${parent.id}`
                },
                context,
                info,
                'Schedule'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        serviceRequest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'ServiceRequest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        specimen: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Specimen'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        supplyDelivery: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'SupplyDelivery'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        supplyRequest: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    requester: `Patient/${parent.id}`
                },
                context,
                info,
                'SupplyRequest'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        task: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'Task'
            );
        },
        /**
         * @param {Resource|null} parent
         * @param {Object} args
         * @param {GraphQLContext} context
         * @param {Object} info
         * @return {Promise<Resource>}
         */
        visionPrescription: async (parent, args, context, info) => {
            return await context.dataApi.getResources(
                parent,
                {
                    ...args,
                    patient: `Patient/${parent.id}`
                },
                context,
                info,
                'VisionPrescription'
            );
        }
    }
};
