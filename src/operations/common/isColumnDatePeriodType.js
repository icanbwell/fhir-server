/**
 * returns whether the specified column in the specified resource is of Date Period type (for validation purposes)
 * @param {string} resourceType
 * @param {string} columnName
 * @returns {boolean}
 */
function isColumnDatePeriodType (resourceType, columnName) {
    if (!resourceType || !columnName) {
        return false;
    }
    switch (resourceType) {
        case 'Account':
            if (columnName === 'servicePeriod' ||
                columnName === 'guarantor.period') {
                return true;
            }
            break;
        case 'ActivityDefinition':
            if (columnName === 'effectivePeriod' ||
                columnName === 'timingPeriod') {
                return true;
            }
            break;
        case 'Appointment':
            if (columnName === 'requestedPeriod' ||
                columnName === 'participant.period') {
                return true;
            }
            break;
        case 'BiologicallyDerivedProduct':
            if (columnName === 'collection.collectedPeriod' ||
                columnName === 'manipulation.timePeriod' ||
                columnName === 'processing.timePeriod' ||
                columnName === 'storage.duration') {
                return true;
            }
            break;
        case 'CarePlan':
            if (columnName === 'activity.detail.scheduledTiming.repeat.boundsPeriod' ||
                columnName === 'activity.detail.scheduledPeriod' ||
                columnName === 'period') {
                return true;
            }
            break;
        case 'CareTeam':
            if (columnName === 'period' ||
                columnName === 'participant.period') {
                return true;
            }
            break;
        case 'CatalogEntry':
            if (columnName === 'validityPeriod') {
                return true;
            }
            break;
       case 'ChargeItem':
            if (columnName === 'occurrencePeriod') {
                return true;
            }
            break;
        case 'ChargeItemDefinition':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'Claim':
            if (columnName === 'item.servicedPeriod' ||
                columnName === 'supportingInfo.timingPeriod') {
                return true;
            }
            break;
        case 'ClaimResponse':
            if (columnName === 'item.servicedPeriod' ||
                columnName === 'addItem.servicedPeriod') {
                return true;
            }
            break;
        case 'CommunicationRequest':
            if (columnName === 'occurrencePeriod') {
                return true;
            }
            break;
       case 'Composition':
            if (columnName === 'event.period') {
                return true;
            }
            break;
        case 'Condition':
            if (columnName === 'abatementPeriod' ||
                columnName === 'onsetPeriod') {
                return true;
            }
            break;
        case 'Consent':
            if (columnName === 'provision.period' ||
                columnName === 'provision.dataPeriod') {
                return true;
            }
            break;
        case 'Contract':
            if (columnName === 'applies' ||
                columnName === 'term.action.occurrencePeriod' ||
                columnName === 'term.action.occurrenceTiming.repeat.boundsPeriod' ||
                columnName === 'term.asset.period' ||
                columnName === 'term.asset.usePeriod' ||
                columnName === 'term.applies') {
                return true;
            }
            break;
        case 'Coverage':
            if (columnName === 'period' ||
                columnName === 'costToBeneficiary.period') {
                return true;
            }
            break;
        case 'CoverageEligibilityRequest':
            if (columnName === 'servicePeriod') {
                return true;
            }
            break;
        case 'CoverageEligibilityResponse':
            if (columnName === 'servicePeriod' ||
                columnName === 'insurance.benefitPeriod') {
                return true;
            }
            break;
        case 'DetectedIssue':
            if (columnName === 'identifiedPeriod') {
                return true;
            }
            break;
        case 'DeviceRequest':
            if (columnName === 'occurrencePeriod') {
                return true;
            }
            break;
        case 'DeviceUseStatement':
            if (columnName === 'timingPeriod') {
                return true;
            }
            break;
        case 'DiagnosticReport':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'DocumentReference':
            if (columnName === 'context.period') {
                return true;
            }
            break;
        case 'EffectEvidenceSynthesis':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'Encounter':
            if (columnName === 'period' ||
                columnName === 'location.period' ||
                columnName === 'classHistory.period' ||
                columnName === 'participant.period' ||
                columnName === 'statusHistory.period') {
                return true;
            }
            break;
        case 'Endpoint':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'EpisodeOfCare':
            if (columnName === 'period' ||
                columnName === 'statusHistory.period') {
                return true;
            }
            break;
        case 'EventDefinition':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'Evidence':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'EvidenceVariable':
            if (columnName === 'effectivePeriod' ||
                columnName === 'characteristic.participantEffectivePeriod' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.boundsPeriod') {
                return true;
            }
            break;
        case 'ExplanationOfBenefit':
            if (columnName === 'preAuthRefPeriod' ||
                columnName === 'benefitPeriod' ||
                columnName === 'item.servicedPeriod' ||
                columnName === 'addItem.servicedPeriod' ||
                columnName === 'supportingInfo.timingPeriod') {
                return true;
            }
            break;
        case 'FamilyMemberHistory':
            if (columnName === 'bornPeriod' ||
                columnName === 'condition.onsetPeriod') {
                return true;
            }
            break;
        case 'Flag':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'Group':
            if (columnName === 'characteristic.period' ||
                columnName === 'member.period') {
                return true;
            }
            break;
        case 'HealthcareService':
            if (columnName === 'notAvailable.during') {
                return true;
            }
            break;
        case 'InsurancePlan':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'Library':
            if (columnName === 'effectivePeriod') {
                return true;
            }
           break;
        case 'Measure':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'MeasureReport':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'Media':
            if (columnName === 'createdPeriod') {
                return true;
            }
            break;
        case 'MedicationAdministration':
            if (columnName === 'effectivePeriod') {
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
                columnName === 'marketingStatus.restoreDate' ||
                columnName === 'procedure.dateDateTime' ||
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
        case 'MedicinalProductPackaged':
            if (columnName === 'marketingStatus.restoreDate') {
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
            if (columnName === 'effectivePeriod' ||
                columnName === 'valuePeriod' ||
                columnName === 'component.valuePeriod') {
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
                columnName === 'occurrenceTiming.event') {
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
            if (columnName === 'date' ||
                columnName === 'snapshot.element.defaultValueInstant' ||
                columnName === 'snapshot.element.fixedInstant' ||
                columnName === 'snapshot.element.patternInstant' ||
                columnName === 'snapshot.element.minvalueInstant' ||
                columnName === 'snapshot.element.maxValueInstant' ||
                columnName === 'snapshot.element.example.valueInstant' ||
                columnName === 'snapshot.element.example.valueDateTime' ||
                columnName === 'snapshot.element.example.valueTiming.event' ||
                columnName === 'snapshot.element.defaultValueDateTime' ||
                columnName === 'snapshot.element.fixedDateTime' ||
                columnName === 'snapshot.element.patternDateTime' ||
                columnName === 'snapshot.element.minValueDateTime' ||
                columnName === 'snapshot.element.maxValueDateTime' ||
                columnName === 'snapshot.element.defaultValueTiming.event' ||
                columnName === 'snapshot.element.fixedTiming.event' ||
                columnName === 'snapshot.element.patternTiming.event' ||
                columnName === 'differential.element.defaultValueInstant' ||
                columnName === 'differential.element.fixedInstant' ||
                columnName === 'differential.element.patternInstant' ||
                columnName === 'differential.element.defaultValueTiming.event' ||
                columnName === 'differential.element.fixedTiming.event' ||
                columnName === 'differential.element.patternTiming.event' ||
                columnName === 'differential.element.minValueInstant' ||
                columnName === 'differential.element.example.valueInstant' ||
                columnName === 'differential.element.example.valueDateTime' ||
                columnName === 'differential.element.example.valueTiming.event' ||
                columnName === 'differential.element.defaultValueDateTime' ||
                columnName === 'differential.element.fixedDateTime' ||
                columnName === 'differential.element.patternDateTime' ||
                columnName === 'differential.element.minValueDateTime' ||
                columnName === 'differential.element.maxValueDateTime' ||
                columnName === 'differential.element.maxValueInstant') {
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
        case 'SubscriptionStatus':
            if (columnName === 'notificationEvent.timestamp') {
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
                columnName === 'occurrenceTiming.event') {
                return true;
            }
            break;
        case 'SupplyRequest':
            if (columnName === 'authoredOn' ||
                columnName === 'occurrenceDateTime' ||
                columnName === 'occurrencePeriod.start' ||
                columnName === 'occurrencePeriod.end' ||
                columnName === 'occurrenceTiming.event') {
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
                columnName === 'input.valueInstant' ||
                columnName === 'input.valueTiming.event' ||
                columnName === 'input.valueTiming.repeat.boundsPeriod.start' ||
                columnName === 'input.valueTiming.repeat.boundsPeriod.end' ||
                columnName === 'input.valueTiming.repeat.timeOfDay' ||
                columnName === 'input.valuePeriod.start' ||
                columnName === 'input.valuePeriod.end' ||
                columnName === 'output.valueDate' ||
                columnName === 'output.valueDateTime' ||
                columnName === 'output.valueTime' ||
                columnName === 'output.valueInstant' ||
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
                columnName === 'frequency.event' ||
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
    isColumnDatePeriodType
};
