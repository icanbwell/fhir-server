/**
 * returns whether the specified column in the specified resource is of Date type
 * @param {string} resourceType
 * @param {string} columnName
 * @returns {boolean}
 */
function isColumnDateType (resourceType, columnName) {
    if (!resourceType || !columnName) {
        return false;
    }
    if (columnName === 'meta.lastUpdated') {
        return true;
    }
    switch (resourceType) {
        case 'AuditEvent':
            if (columnName === 'recorded') {
                return true;
            }
            break;
        case 'Account':
            if (columnName === 'servicePeriod.start' ||
                columnName === 'servicePeriod.end' ||
                columnName === 'guarantor.period.start' ||
                columnName === 'guarantor.period.end') {
                return true;
            }
            break;
        case 'ActivityDefinition':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end') {
                return true;
            }
            break;
        case 'AdverseEvent':
            if (columnName === 'date' ||
                columnName === 'detected' ||
                columnName === 'recordedDate') {
                return true;
            }
            break;
        case 'AllergyIntolerance':
            if (columnName === 'recordedDate' ||
                columnName === 'lastOccurrence' ||
                columnName === 'onsetDateTime' ||
                columnName === 'reaction.onset') {
                return true;
            }
            break;
        case 'Appointment':
            if (columnName === 'created' ||
                columnName === 'start' ||
                columnName === 'end' ||
                columnName === 'requestedPeriod.start' ||
                columnName === 'requestedPeriod.end' ||
                columnName === 'participant.period.start' ||
                columnName === 'participant.period.end') {
                return true;
            }
            break;
        case 'Basic':
            if (columnName === 'created') {
                return true;
            }
            break;
        case 'BiologicallyDerivedProduct':
            if (columnName === 'collection.collectedPeriod.start' ||
                columnName === 'collection.collectedPeriod.end' ||
                columnName === 'collection.collectedDateTime' ||
                columnName === 'manipulation.timePeriod.start' ||
                columnName === 'manipulation.timePeriod.end' ||
                columnName === 'manipulation.timeDateTime' ||
                columnName === 'processing.timePeriod.start' ||
                columnName === 'processing.timePeriod.end' ||
                columnName === 'processing.timeDateTime' ||
                columnName === 'storage.duration.start' ||
                columnName === 'storage.duration.end') {
                return true;
            }
            break;
        case 'Bundle':
            if (columnName === 'timestamp') {
                return true;
            }
            break;
        case 'CapabilityStatement':
            if (columnName === 'date' ||
                columnName === 'software.releaseDate') {
                return true;
            }
            break;
        case 'CarePlan':
            if (columnName === 'activity.detail.scheduledTiming.event' ||
                columnName === 'activity.detail.scheduledTiming.repeat.boundsPeriod.start' ||
                columnName === 'activity.detail.scheduledTiming.repeat.boundsPeriod.end' ||
                columnName === 'activity.detail.scheduledTiming.repeat.timeOfDay' ||
                columnName === 'activity.detail.scheduledPeriod.start' ||
                columnName === 'activity.detail.scheduledPeriod.end' ||
                columnName === 'activity.detail.scheduledString' ||
                columnName === 'period.start' ||
                columnName === 'period.end' ||
                columnName === 'created') {
                return true;
            }
            break;
        case 'CareTeam':
            if (columnName === 'period.start' ||
                columnName === 'period.end' ||
                columnName === 'participant.period.start' ||
                columnName === 'participant.period.end') {
                return true;
            }
            break;
        case 'CatalogEntry':
            if (columnName === 'valueTo' ||
                columnName === 'validityPeriod.start' ||
                columnName === 'validityPeriod.end' ||
                columnName === 'lastUpdated') {
                return true;
            }
            break;
       case 'ChargeItem':
            if (columnName === 'enteredDate' ||
                columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end' ||
                columnName === 'occurrenceTiming') {
                return true;
            }
            break;
        case 'ChargeItemDefinition':
            if (columnName === 'date' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate') {
                return true;
            }
            break;
        case 'Claim':
            if (columnName === 'created' ||
                columnName === 'item.servicedDate' ||
                columnName === 'item.servicedPeriod.start' ||
                columnName === 'item.servicedPeriod.end' ||
                columnName === 'supportingInfo.timingDate' ||
                columnName === 'supportingInfo.timingPeriod.start' ||
                columnName === 'supportingInfo.timingPeriod.end') {
                return true;
            }
            break;
        case 'ClaimResponse':
            if (columnName === 'created' ||
                columnName === 'payment.date' ||
                columnName === 'item.servicedDate' ||
                columnName === 'item.servicedPeriod.start' ||
                columnName === 'item.servicedPeriod.end' ||
                columnName === 'addItem.servicedDate' ||
                columnName === 'addItem.servicedPeriod.start' ||
                columnName === 'addItem.servicedPeriod.end' ||
                columnName === 'procedure.date') {
                return true;
            }
            break;
        case 'ClinicalImpression':
            if (columnName === 'date' || columnName === 'effectiveDateTime') {
                return true;
            }
            break;
        case 'CodeSystem':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'Communication':
            if (columnName === 'received' || columnName === 'sent') {
                return true;
            }
            break;
        case 'CommunicationRequest':
            if (columnName === 'authoredOn' ||
                columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end') {
                return true;
            }
            break;
        case 'CompartmentDefinition':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'Composition':
            if (columnName === 'date' ||
                columnName === 'event.period.start' ||
                columnName === 'event.period.end' ||
                columnName === 'attester.time') {
                return true;
            }
            break;
        case 'ConceptMap':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'Condition':
            if (columnName === 'abatementDateTime' ||
                columnName === 'abatementPeriod.start' ||
                columnName === 'abatementPeriod.end' ||
                columnName === 'onsetDateTime' ||
                columnName === 'onsetPeriod.start' ||
                columnName === 'onsetPeriod.end' ||
                columnName === 'recordedDate') {
                return true;
            }
            break;
        case 'Consent':
            if (columnName === 'dateTime' ||
                columnName === 'provision.period.start' ||
                columnName === 'provision.period.end' ||
                columnName === 'provision.dataPeriod.start' ||
                columnName === 'provision.dataPeriod.end' ||
                columnName === 'verification.verificationDate') {
                return true;
            }
            break;
        case 'Contract':
            if (columnName === 'issued' ||
                columnName === 'applies.start' ||
                columnName === 'applies.end' ||
                columnName === 'contentDefinition.publicationDate' ||
                columnName === 'term.action.occurrencePeriod.start' ||
                columnName === 'term.action.occurrencePeriod.end' ||
                columnName === 'term.action.occurrenceTiming.event' ||
                columnName === 'term.action.occurrenceTiming.repeat.boundsPeriod.start' ||
                columnName === 'term.action.occurrenceTiming.repeat.boundsPeriod.end' ||
                columnName === 'term.action.occurrenceTiming.repeat.timeOfDay' ||
                columnName === 'term.action.occurrenceDateTime' ||
                columnName === 'term.asset.period.start' ||
                columnName === 'term.asset.period.end' ||
                columnName === 'term.asset.usePeriod.start' ||
                columnName === 'term.asset.usePeriod.end' ||
                columnName === 'term.asset.answer.valueDateTime' ||
                columnName === 'term.asset.answer.valueDate' ||
                columnName === 'term.asset.answer.valueTime' ||
                columnName === 'term.asset.valuedItem.effectiveTime' ||
                columnName === 'term.asset.valuedItem.paymentDate' ||
                columnName === 'term.offer.answer.valueDateTime' ||
                columnName === 'term.offer.answer.valueDate' ||
                columnName === 'term.offer.answer.valueTime' ||
                columnName === 'term.applies.start' ||
                columnName === 'term.applies.end' ||
                columnName === 'term.issued') {
                return true;
            }
            break;
        case 'Coverage':
            if (columnName === 'period.start' ||
                columnName === 'period.end' ||
                columnName === 'costToBeneficiary.period.start' ||
                columnName === 'costToBeneficiary.period.end') {
                return true;
            }
            break;
        case 'CoverageEligibilityRequest':
            if (columnName === 'created' ||
                columnName === 'serviceDate' ||
                columnName === 'servicePeriod.start' ||
                columnName === 'servicePeriod.end') {
                return true;
            }
            break;
        case 'CoverageEligibilityResponse':
            if (columnName === 'created' ||
                columnName === 'serviceDate' ||
                columnName === 'servicePeriod.start' ||
                columnName === 'servicePeriod.end' ||
                columnName === 'insurance.benefitPeriod.start' ||
                columnName === 'insurance.benefitPeriod.end') {
                return true;
            }
            break;
        case 'DetectedIssue':
            if (columnName === 'identifiedDateTime' ||
                columnName === 'identifiedPeriod.start' ||
                columnName === 'identifiedPeriod.end' ||
                columnName === 'mitigation.date') {
                return true;
            }
            break;
        case 'Device':
            if (columnName === 'manufactureDate' ||
                columnName === 'expirationDate') {
                return true;
            }
            break;
        case 'DeviceMetric':
            if (columnName === 'calibration.time') {
                return true;
            }
            break;
        case 'DeviceRequest':
            if (columnName === 'authoredOn' ||
                columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end' ||
                columnName === 'occurrenceTiming') {
                return true;
            }
            break;
        case 'DeviceUseStatement':
            if (columnName === 'recordedOn' ||
                columnName === 'timingDateTime' ||
                columnName === 'timingTiming' ||
                columnName === 'timingPeriod.start' ||
                columnName === 'timingPeriod.end') {
                return true;
            }
            break;
        case 'DiagnosticReport':
            if (columnName === 'effectiveDateTime' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'issued') {
                return true;
            }
            break;
        case 'DocumentManifest':
            if (columnName === 'created') {
                return true;
            }
            break;
        case 'DocumentReference':
            if (columnName === 'date' ||
                columnName === 'context.period' ||
                columnName === 'context.period.end') {
                return true;
            }
            break;
        case 'EffectEvidenceSynthesis':
            if (columnName === 'date' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate') {
                return true;
            }
            break;
        case 'Encounter':
            if (columnName === 'period.start' ||
                columnName === 'period.end' ||
                columnName === 'location.period.start' ||
                columnName === 'location.period.end' ||
                columnName === 'classHistory.period.start' ||
                columnName === 'classHistory.period.end' ||
                columnName === 'participant.period.start' ||
                columnName === 'participant.period.end' ||
                columnName === 'statusHistory.period.start' ||
                columnName === 'statusHistory.period.end') {
                return true;
            }
            break;
        case 'Endpoint':
            if (columnName === 'period.start' ||
                columnName === 'period.end') {
                return true;
            }
            break;
        case 'EnrollmentRequest':
            if (columnName === 'created') {
                return true;
            }
            break;
        case 'EnrollmentResponse':
            if (columnName === 'created') {
                return true;
            }
            break;
        case 'EpisodeOfCare':
            if (columnName === 'period.start' ||
                columnName === 'period.end' ||
                columnName === 'statusHistory.period.start' ||
                columnName === 'statusHistory.period.end') {
                return true;
            }
            break;
        case 'EventDefinition':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end') {
                return true;
            }
            break;
        case 'Evidence':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end') {
                return true;
            }
            break;
        case 'EvidenceVariable':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'characteristic.participantEffectivePeriod.start' ||
                columnName === 'characteristic.participantEffectivePeriod.end' ||
                columnName === 'characteristic.participantEffectiveTiming.event' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.boundsPeriod.start' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.boundsPeriod.end' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.timeOfDay' ||
                columnName === 'characteristic.participantEffectiveDateTime') {
                return true;
            }
            break;
        case 'ExampleScenario':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'ExplanationOfBenefit':
            if (columnName === 'created' ||
                columnName === 'preAuthRefPeriod.start' ||
                columnName === 'preAuthRefPeriod.end' ||
                columnName === 'benefitPeriod.start' ||
                columnName === 'benefitPeriod.end' ||
                columnName === 'accident.date' ||
                columnName === 'item.servicedDate' ||
                columnName === 'item.servicedPeriod.start' ||
                columnName === 'item.servicedPeriod.end' ||
                columnName === 'addItem.servicedDate' ||
                columnName === 'addItem.servicedPeriod.start' ||
                columnName === 'addItem.servicedPeriod.end' ||
                columnName === 'payment.date' ||
                columnName === 'supportingInfo.timingDate' ||
                columnName === 'supportingInfo.timingPeriod.start' ||
                columnName === 'supportingInfo.timingPeriod.end' ||
                columnName === 'procedure.date') {
                return true;
            }
            break;
        case 'FamilyMemberHistory':
            if (columnName === 'date' ||
                columnName === 'bornDate' ||
                columnName === 'bornPeriod.start' ||
                columnName === 'bornPeriod.end' ||
                columnName === 'deceasedDate' ||
                columnName === 'condition.onsetPeriod.start' ||
                columnName === 'condition.onsetPeriod.end') {
                return true;
            }
            break;
        case 'Flag':
            if (columnName === 'period.start' ||
                columnName === 'period.end') {
                return true;
            }
            break;
        case 'Goal':
            if (columnName === 'startDate' ||
                columnName === 'target.dueDate' ||
                columnName === 'statusDate') {
                return true;
            }
            break;
        case 'GraphDefinition':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'Group':
            if (columnName === 'characteristic.period.start' ||
                columnName === 'characteristic.period.end' ||
                columnName === 'member.period.start' ||
                columnName === 'member.period.end') {
                return true;
            }
            break;
        case 'GuidanceResponse':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'HealthcareService':
            if (columnName === 'availableTime.availableStartTime' ||
                columnName === 'availableTime.availableEndTime' ||
                columnName === 'notAvailable.during.start' ||
                columnName === 'notAvailable.during.end') {
                return true;
            }
            break;
        case 'ImagingStudy':
            if (columnName === 'started') {
                return true;
            }
            break;
        case 'Immunization':
            if (columnName === 'occurrenceDateTime' ||
                columnName === 'occurrenceString' ||
                columnName === 'expirationDate' ||
                columnName === 'series.started' ||
                columnName === 'education.publicationDate' ||
                columnName === 'education.presentationDate' ||
                columnName === 'reaction.date') {
                return true;
            }
            break;
        case 'ImmunizationEvaluation':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'ImmunizationRecommendation':
            if (columnName === 'date' ||
                columnName === 'recommendation.dateCriterion.date') {
                return true;
            }
            break;
        case 'ImplementationGuide':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'InsurancePlan':
            if (columnName === 'period.start' ||
                columnName === 'period.end') {
                return true;
            }
            break;
        case 'Invoice':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'Library':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end') {
                return true;
            }
           break;
        case 'List':
            if (columnName === 'date' ||
                columnName === 'entry.date') {
                return true;
            }
            break;
        case 'Location':
            if (columnName === 'hoursOfOperation.openingTime' ||
                columnName === 'hoursOfOperation.closingTime') {
                return true;
            }
            break;
        case 'Measure':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end') {
                return true;
            }
            break;
        case 'MeasureReport':
            if (columnName === 'date' ||
                columnName === 'period.start' ||
                columnName === 'period.end') {
                return true;
            }
            break;
        case 'Media':
            if (columnName === 'createdDateTime' ||
                columnName === 'createdPeriod.start' ||
                columnName === 'createdPeriod.end' ||
                columnName === 'issued') {
                return true;
            }
            break;
        case 'Medication':
            if (columnName === 'batch.expirationDate') {
                return true;
            }
            break;
        case 'MedicationAdministration':
            if (columnName === 'effectiveDateTime' || columnName === 'effectivePeriod.start' || columnName === 'effectivePeriod.end') {
                return true;
            }
            break;
        case 'MedicationDispense':
            if (columnName === 'whenPrpared' || columnName === 'whenHandedOver') {
                return true;
            }
            break;
        case 'MedicationRequest':
            if (columnName === 'authoredOn' ||
                columnName === 'dosageInstruction.timing.event' ||
                columnName === 'dosageInstruction.timing.repeat.boundsPeriod.start' ||
                columnName === 'dosageInstruction.timing.repeat.boundsPeriod.end' ||
                columnName === 'dosageInstruction.timing.repeat.timeOfDay' ||
                columnName === 'dispenseRequest.validityPeriod.start' ||
                columnName === 'dispenseRequest.validityPeriod.end') {
                return true;
            }
            break;
        case 'MedicationStatement':
            if (columnName === 'effectiveDateTime' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'dateAsserted') {
                return true;
            }
            break;
        case 'MedicinalProduct':
            if (columnName === 'manufacturingBusinessOperation.effectiveDate' ||
                columnName === 'specialDesignation.date') {
                return true;
            }
            break;
        case 'MedicinalProductAuthorization':
            if (columnName === 'statusDate' ||
                columnName === 'restoreDate' ||
                columnName === 'dateOfFirstAuthorization' ||
                columnName === 'internationalBirthDate' ||
                columnName === 'validityPeriod.start' ||
                columnName === 'validityPeriod.end' ||
                columnName === 'dataExclusivityPeriod.start' ||
                columnName === 'dataExclusivityPeriod.end' ||
                columnName === 'jurisdictionalAuthorization.validityPeriod.start' ||
                columnName === 'jurisdictionalAuthorization.validityPeriod.end' ||
                columnName === 'procedure.datePeriod.start' ||
                columnName === 'procedure.datePeriod.end' ||
                columnName === 'procedure.dateDateTime') {
                return true;
            }
            break;
        case 'MessageDefinition':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'NamingSystem':
            if (columnName === 'date' ||
                columnName === 'uniqueId.period.start' ||
                columnName === 'uniqueId.period.end') {
                return true;
            }
            break;
        case 'NutritionOrder':
            if (columnName === 'dateTime' ||
                columnName === 'enteralFormula.administration.schedule.event' ||
                columnName === 'enteralFormula.administration.schedule.repeat.boundsPeriod.start' ||
                columnName === 'enteralFormula.administration.schedule.repeat.boundsPeriod.end' ||
                columnName === 'enteralFormula.administration.schedule.repeat.timeOfDay' ||
                columnName === 'oralDiet.schedule.event' ||
                columnName === 'oralDiet.schedule.repeat.boundsPeriod.start' ||
                columnName === 'oralDiet.schedule.repeat.boundsPeriod.end' ||
                columnName === 'oralDiet.schedule.repeat.timeOfDay' ||
                columnName === 'supplement.schedule.event' ||
                columnName === 'supplement.schedule.repeat.boundsPeriod.start' ||
                columnName === 'supplement.schedule.repeat.boundsPeriod.end' ||
                columnName === 'supplement.schedule.repeat.timeOfDay') {
                return true;
            }
            break;
        case 'Observation':
            if (columnName === 'effectiveDateTime' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'effectiveTiming.event' ||
                columnName === 'effectiveInstant' ||
                columnName === 'issued' ||
                columnName === 'valueTime' ||
                columnName === 'valueDateTime' ||
                columnName === 'valuePeriod.start' ||
                columnName === 'valuePeriod.end' ||
                columnName === 'component.valuePeriod.start' ||
                columnName === 'component.valuePeriod.end' ||
                columnName === 'component.valueDateTime' ||
                columnName === 'component.valueTime') {
                return true;
            }
            break;
        case 'OperationDefinition':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'OrganizationAffiliation':
            if (columnName === 'period.start' ||
                columnName === 'period.end') {
                return true;
            }
            break;
        case 'Parameters':
            if (columnName === 'parameter.valueDate' ||
                columnName === 'parameter.valueDateTime' ||
                columnName === 'parameter.valueInstant' ||
                columnName === 'parameter.valuePeriod.start' ||
                columnName === 'parameter.valuePeriod.end' ||
                columnName === 'parameter.valueTime' ||
                columnName === 'parameter.valueTiming.event' ||
                columnName === 'parameter.valueTiming.repeat.boundsPeriod.start' ||
                columnName === 'parameter.valueTiming.repeat.boundsPeriod.end' ||
                columnName === 'parameter.valueTiming.repeat.timeOfDay') {
                return true;
            }
            break;
        case 'Patient':
            if (columnName === 'birthDate' ||
                columnName === 'deceasedDateTime' ||
                columnName === 'contact.period.start' ||
                columnName === 'contact.period.end') {
                return true;
            }
            break;
        case 'PaymentNotice':
            if (columnName === 'created' ||
                columnName === 'paymentDate') {
                return true;
            }
            break;
        case 'PaymentReconciliation':
            if (columnName === 'created' ||
                columnName === 'paymentDate' ||
                columnName === 'detail.date') {
                return true;
            }
            break;
        case 'Person':
            if (columnName === 'birthDate') {
                return true;
            }
            break;
        case 'PlanDefinition':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'action.timingDateTime' ||
                columnName === 'action.timingPeriod.start' ||
                columnName === 'action.timingPeriod.end' ||
                columnName === 'action.timingTiming.event' ||
                columnName === 'action.timingTiming.repeat.boundsPeriod.start' ||
                columnName === 'action.timingTiming.repeat.boundsPeriod.end' ||
                columnName === 'action.timingTiming.repeat.timeOfDay') {
                return true;
            }
            break;
        case 'Practitioner':
            if (columnName === 'birthDate' ||
                columnName === 'qualification.period.start' ||
                columnName === 'qualification.period.end') {
                return true;
            }
            break;
        case 'PractitionerRole':
            if (columnName === 'period.start' ||
                columnName === 'period.end' ||
                columnName === 'availableTime.availableStartTime' ||
                columnName === 'availableTime.availableEndTime' ||
                columnName === 'notAvailable.during.start' ||
                columnName === 'notAvailable.during.end') {
                return true;
            }
            break;
        case 'Procedure':
            if (columnName === 'performedDateTime' ||
                columnName === 'performedPeriod.start' ||
                columnName === 'performedPeriod.end') {
                return true;
            }
            break;
        case 'Provenance':
            if (columnName === 'recorded' ||
                columnName === 'occurredDateTime' ||
                columnName === 'occurredPeriod.start' ||
                columnName === 'occurredPeriod.end') {
                return true;
            }
            break;
        case 'Questionaire':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'item.answerOption.valueDate' ||
                columnName === 'item.answerOption.valueTime' ||
                columnName === 'item.enableWhen.answerDate' ||
                columnName === 'item.enableWhen.answerDateTime' ||
                columnName === 'item.enableWhen.answerTime' ||
                columnName === 'item.initial.valueDate' ||
                columnName === 'item.initial.valueDateTime' ||
                columnName === 'item.initital.valueTime') {
                return true;
            }
            break;
        case 'QuestionaireResponse':
            if (columnName === 'authored' ||
                columnName === 'item.answer.valueDate' ||
                columnName === 'item.answer.valueDateTime' ||
                columnName === 'item.answer.valueTime') {
                return true;
            }
            break;
        case 'RelatedPerson':
            if (columnName === 'birthDate' ||
                columnName === 'period.start' ||
                columnName === 'period.end') {
                return true;
            }
            break;
        case 'RequestGroup':
            if (columnName === 'authoredOn' ||
                columnName === 'action.timingDateTime' ||
                columnName === 'action.timingTiming.event' ||
                columnName === 'action.timingTiming.repeat.boundsPeriod.start' ||
                columnName === 'action.timingTiming.repeat.boundsPeriod.end' ||
                columnName === 'action.timingTiming.repeat.timeOfDay' ||
                columnName === 'action.timingPeriod.start' ||
                columnName === 'action.timingPeriod.end') {
                return true;
            }
            break;
        case 'ResearchDefinition':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end') {
                return true;
            }
            break;
        case 'ResearchElementDefinition':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end' ||
                columnName === 'characteristic.studyEffectiveDateTime' ||
                columnName === 'characteristic.studyEffectivePeriod.start' ||
                columnName === 'characteristic.studyEffectivePeriod.end' ||
                columnName === 'characteristic.studyEffectiveTiming.event' ||
                columnName === 'characteristic.studyEffectiveTiming.repeat.boundsPeriod.start' ||
                columnName === 'characteristic.studyEffectiveTiming.repeat.boundsPeriod.end' ||
                columnName === 'characteristic.studyEffectiveTiming.repeat.timeOfDay' ||
                columnName === 'characteristic.participantEffectiveDateTime' ||
                columnName === 'characteristic.participantEffectivePeriod.start' ||
                columnName === 'characteristic.participantEffectivePeriod.end' ||
                columnName === 'characteristic.participantEffectiveTiming.event' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.boundsPeriod.start' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.boundsPeriod.end' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.timeOfDay') {
                return true;
            }
           break;
        case 'ResearchStudy':
            if (columnName === 'period.start' || columnName === 'period.end') {
                return true;
            }
            break;
        case 'ResearchSubject':
            if (columnName === 'period.start' || columnName === 'period.end') {
                return true;
            }
            break;
        case 'RiskAssessment':
            if (columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end' ||
                columnName === 'prediction.whenPeriod.start' ||
                columnName === 'prediction.whenPeriod.end') {
                return true;
            }
            break;
        case 'RiskEvidenceSynthesis':
            if (columnName === 'date' ||
                columnName === 'approvalDate' ||
                columnName === 'lastReviewDate' ||
                columnName === 'effectivePeriod.start' ||
                columnName === 'effectivePeriod.end') {
                return true;
            }
            break;
        case 'Schedule':
            if (columnName === 'planningHorizon.start' ||
                columnName === 'planningHorizon.end') {
                return true;
            }
            break;
        case 'SearchParameter':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'ServiceRequest':
            if (columnName === 'authoredOn' ||
                columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end' ||
                columnName === 'occurrenceTiming') {
                return true;
            }
            break;
        case 'Slot':
            if (columnName === 'start' ||
                columnName === 'end') {
                return true;
            }
            break;
        case 'Specimen':
            if (columnName === 'receivedTime' ||
                columnName === 'collection.collectedDateTime' ||
                columnName === 'collection.collectedPeriod.start' ||
                columnName === 'collection.collectedPeriod.end' ||
                columnName === 'processing.timeDatetime' ||
                columnName === 'processing.timePeriod.start' ||
                columnName === 'processing.timePeriod.end') {
                return true;
            }
            break;
        case 'StructureDefinition':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'StructureMap':
            if (columnName === 'date' ||
                columnName === 'group.rule.source.defaultValuePeriod.start' ||
                columnName === 'group.rule.source.defaultValuePeriod.end' ||
                columnName === 'group.rule.source.defaultValueTiming.event' ||
                columnName === 'group.rule.source.defaultValueTiming.repeat.boundsPeriod.start' ||
                columnName === 'group.rule.source.defaultValueTiming.repeat.boundsPeriod.end' ||
                columnName === 'group.rule.source.defaultValueTiming.repeat.timeOfDay' ||
                columnName === 'group.rule.source.defaultValueDateTime' ||
                columnName === 'group.rule.source.defaultValueInstant' ||
                columnName === 'group.rule.source.defaultValueTime') {
                return true;
            }
            break;
        case 'Subscription':
            if (columnName === 'end') {
                return true;
            }
            break;
        case 'Substance':
            if (columnName === 'instance.expiry') {
                return true;
            }
            break;
        case 'SubstanceSpecification':
            if (columnName === 'code.statusDate' ||
                columnName === 'name.official.date') {
                return true;
            }
            break;
        case 'SupplyDelivery':
            if (columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end' ||
                columnName === 'occurrenceTiming') {
                return true;
            }
            break;
        case 'SupplyRequest':
            if (columnName === 'authoredOn' ||
                columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end' ||
                columnName === 'occurrenceTiming') {
                return true;
            }
            break;
        case 'Task':
            if (columnName === 'authoredOn' ||
                columnName === 'lastModified' ||
                columnName === 'executionPeriod.start' ||
                columnName === 'executionPeriod.end' ||
                columnName === 'input.valueDate' ||
                columnName === 'input.valueDateTime' ||
                columnName === 'input.valueTime' ||
                columnName === 'input.valueTiming.event' ||
                columnName === 'input.valueTiming.repeat.boundsPeriod.start' ||
                columnName === 'input.valueTiming.repeat.boundsPeriod.end' ||
                columnName === 'input.valueTiming.repeat.timeOfDay' ||
                columnName === 'input.valuePeriod.start' ||
                columnName === 'input.valuePeriod.end' ||
                columnName === 'output.valueDate' ||
                columnName === 'output.valueDateTime' ||
                columnName === 'output.valueTime' ||
                columnName === 'output.valueTiming.event' ||
                columnName === 'output.valueTiming.repeat.boundsPeriod.start' ||
                columnName === 'output.valueTiming.repeat.boundsPeriod.end' ||
                columnName === 'output.valueTiming.repeat.timeOfDay' ||
                columnName === 'output.valuePeriod.start' ||
                columnName === 'output.valuePeriod.end' ||
                columnName === 'restriction.period.start' ||
                columnName === 'restriction.period.end') {
                return true;
            }
            break;
        case 'TerminologyCapabilities':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'TestReport':
            if (columnName === 'issued') {
                return true;
            }
            break;
        case 'TestScript':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'ValueSet':
            if (columnName === 'date' ||
                columnName === 'compose.lockedDate' ||
                columnName === 'expansion.timestamp' ||
                columnName === 'expansion.parameter.valueDateTime') {
                return true;
            }
            break;
        case 'VerificationResult':
            if (columnName === 'statusDate' ||
                columnName === 'frequency' ||
                columnName === 'lastPerformed' ||
                columnName === 'nextScheduled' ||
                columnName === 'attestation.date' ||
                columnName === 'primarySource.validationDate') {
                    return true;
            }
            break;
        case 'VisionPrescription':
            if (columnName === 'created' ||
                columnName === 'dateWritten') {
                return true;
            }
            break;
   }

    return false;
}

module.exports = {
    isColumnDateType
};
