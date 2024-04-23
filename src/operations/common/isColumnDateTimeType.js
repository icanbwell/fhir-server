/**
 * returns whether the specified column in the specified resource is of DateTime type (for validation purposes)
 * also covers instant type
 * @param {string} resourceType
 * @param {string} columnName
 * @returns {boolean}
 */
function isColumnDateTimeType (resourceType, columnName) {
    if (!resourceType || !columnName) {
        return false;
    }
    switch (resourceType) {
        case 'AuditEvent':
            if (columnName === 'recorded') {
                return true;
            }
            break;
      case 'ActivityDefinition':
            if (columnName === 'timingDateTime' ||
                columnName === 'timingTiming.event') {
                return true;
            }
            break;
        case 'AllergyIntolerance':
            if (columnName === 'onsetDateTime' ||
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
        case 'AppointmentResponse':
            if (columnName === 'start' ||
                columnName === 'end') {
                return true;
            }
            break;
        case 'BiologicallyDerivedProduct':
            if (columnName === 'manipulation.timeDateTime' ||
                columnName === 'collection.collectedDateTime' ||
                columnName === 'processing.timeDateTime') {
                return true;
            }
            break;
        case 'Bundle':
            if (columnName === 'timestamp' ||
                columnName === 'entry.request.ifModifiedSince' ||
                columnName === 'entry.response.lastModified') {
                return true;
            }
            break;
        case 'CapabilityStatement':
            if (columnName === 'software.releaseDate') {
                return true;
            }
            break;
        case 'CarePlan':
            if (columnName === 'activity.detail.scheduledTiming.event' ||
                columnName === 'activity.detail.scheduledTiming.repeat.timeOfDay') {
                return true;
            }
            break;
       case 'ChargeItem':
            if (columnName === 'occurrenceDateTime' ||
                columnName === 'occurrenceTiming.event') {
                return true;
            }
            break;
        case 'Claim':
            if (columnName === 'procedure.date') {
                return true;
            }
            break;
        case 'ClaimResponse':
            if (columnName === 'procedure.date') {
                return true;
            }
            break;
        case 'ClinicalImpression':
            if (columnName === 'effectiveDateTime') {
                return true;
            }
            break;
        case 'CodeSystem':
            if (columnName === 'concept.property.valueDateTime') {
                return true;
            }
            break;
        case 'CommunicationRequest':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'CompartmentDefinition':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'Composition':
            if (columnName === 'attester.time') {
                return true;
            }
            break;
        case 'Condition':
            if (columnName === 'abatementDateTime' ||
                columnName === 'onsetDateTime') {
                return true;
            }
            break;
        case 'Consent':
            if (columnName === 'dateTime' ||
                columnName === 'verification.verificationDate') {
                return true;
            }
            break;
        case 'Contract':
            if (columnName === 'term.action.occurrenceDateTime' ||
                columnName === 'term.action.occurrenceTiming.event' ||
                columnName === 'term.action.occurrenceTiming.repeat.timeOfDay' ||
                columnName === 'term.asset.answer.valueDateTime' ||
                columnName === 'term.asset.answer.valueDate' ||
                columnName === 'contentDefinition.publicationDate' ||
                columnName === 'term.issued' ||
                columnName === 'term.asset.valuedItem.effectiveTime' ||
                columnName === 'term.asset.valuedItem.paymentDate' ||
                columnName === 'term.offer.answer.valueDateTime') {
                return true;
            }
            break;
        case 'DetectedIssue':
            if (columnName === 'identifiedDateTime' ||
                columnName === 'mitigation.date') {
                return true;
            }
            break;
        case 'DeviceMetric':
            if (columnName === 'calibration.time' ||
                columnName === 'measurementPeriod.event') {
                return true;
            }
            break;
        case 'DeviceRequest':
            if (columnName === 'occurrenceDateTime' ||
                columnName === 'occurrenceTiming.event') {
                return true;
            }
            break;
        case 'DeviceUseStatement':
            if (columnName === 'timingTiming.event' ||
                columnName === 'timingDateTime') {
                return true;
            }
            break;
        case 'DiagnosticReport':
            if (columnName === 'effectiveDateTime' ||
                columnName === 'issued') {
                return true;
            }
            break;
        case 'DocumentReference':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'EvidenceVariable':
            if (columnName === 'characteristic.participantEffectiveDateTime' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.timeOfDay' ||
                columnName === 'characteristic.participantEffectiveTiming.event') {
                return true;
            }
            break;
        case 'ExplanationOfBenefit':
            if (columnName === 'procedure.date') {
                return true;
            }
            break;
        case 'GuidanceResponse':
            if (columnName === 'occurrenceDateTime') {
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
                columnName === 'education.publicationDate' ||
                columnName === 'education.presentationDate' ||
                columnName === 'reaction.date') {
                return true;
            }
            break;
        case 'ImmunizationRecommendation':
            if (columnName === 'recommendation.dateCriterion.value') {
                return true;
            }
            break;
        case 'List':
            if (columnName === 'entry.date') {
                return true;
            }
            break;
        case 'Media':
            if (columnName === 'createdDateTime' ||
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
            if (columnName === 'effectiveDateTime') {
                return true;
            }
            break;
        case 'MedicationRequest':
            if (columnName === 'dosageInstruction.timing.event' ||
                columnName === 'dosageInstruction.timing.repeat.timeOfDay') {
                return true;
            }
            break;
        case 'MedicationStatement':
            if (columnName === 'effectiveDateTime') {
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
        case 'MedicinalProductPackaged':
            if (columnName === 'marketingStatus.restoreDate') {
                return true;
            }
            break;
        case 'NutritionOrder':
            if (columnName === 'enteralFormula.administration.schedule.event' ||
                columnName === 'oralDiet.schedule.event' ||
                columnName === 'supplement.schedule.event' ||
                columnName === 'dateTime') {
                return true;
            }
            break;
        case 'Observation':
            if (columnName === 'effectiveDateTime' ||
                columnName === 'valueDateTime' ||
                columnName === 'effectiveInstant' ||
                columnName === 'issued' ||
                columnName === 'effectiveTiming.event' ||
                columnName === 'component.valueDateTime') {
                return true;
            }
            break;
        case 'Parameters':
            if (columnName === 'parameter.valueDateTime' ||
                columnName === 'parameter.valueTiming.event' ||
                columnName === 'parameter.valueInstant') {
                return true;
            }
            break;
        case 'Patient':
            if (columnName === 'deceasedDateTime') {
                return true;
            }
            break;
        case 'PlanDefinition':
            if (columnName === 'action.timingTiming.event' ||
                columnName === 'action.timingDateTime' ||
                columnName === 'action.timingTiming.repeat.timeOfDay') {
                return true;
            }
            break;
        case 'Procedure':
            if (columnName === 'performedDateTime') {
                return true;
            }
            break;
        case 'Provenance':
            if (columnName === 'occurredDateTime' ||
                columnName === 'recorded') {
                return true;
            }
            break;
        case 'Questionaire':
            if (columnName === 'item.enableWhen.answerDateTime' ||
                columnName === 'item.initial.valueDateTime') {
                return true;
            }
            break;
        case 'QuestionaireResponse':
            if (columnName === 'item.answer.valueDateTime') {
                return true;
            }
            break;
        case 'RequestGroup':
            if (columnName === 'action.timingTiming.event' ||
                columnName === 'action.timingTiming.repeat.timeOfDay' ||
                columnName === 'action.timingDateTime') {
                return true;
            }
            break;
        case 'ResearchElementDefinition':
            if (columnName === 'characteristic.studyEffectiveDateTime' ||
                columnName === 'characteristic.studyEffectiveTiming.event' ||
                columnName === 'characteristic.studyEffectiveTiming.repeat.timeOfDay' ||
                columnName === 'characteristic.participantEffectiveTiming.event' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.timeOfDay' ||
                columnName === 'characteristic.participantEffectiveDateTime') {
                return true;
            }
           break;
        case 'RiskAssessment':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'ServiceRequest':
            if (columnName === 'occurrenceDateTime' ||
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
            if (columnName === 'collection.collectedDateTime' ||
                columnName === 'processing.timeDatetime') {
                return true;
            }
            break;
        case 'StructureDefinition':
            if (columnName === 'snapshot.element.defaultValueInstant' ||
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
                columnName === 'differential.element.minValueInstant' ||
                columnName === 'differential.element.defaultValueTiming.event' ||
                columnName === 'differential.element.fixedTiming.event' ||
                columnName === 'differential.element.patternTiming.event' ||
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
            if (columnName === 'group.rule.source.defaultValueDateTime' ||
                columnName === 'group.rule.source.defaultValueInstant' ||
                columnName === 'group.rule.source.defaultValueTiming.event' ||
                columnName === 'group.rule.source.defaultValueTiming.repeat.timeOfDay' ||
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
                columnName === 'occurrenceTiming.event') {
                return true;
            }
            break;
        case 'SupplyRequest':
            if (columnName === 'occurrenceDateTime' ||
                columnName === 'occurrenceTiming.event') {
                return true;
            }
            break;
        case 'Task':
            if (columnName === 'input.valueDateTime' ||
                columnName === 'input.valueInstant' ||
                columnName === 'input.valueTiming.event' ||
                columnName === 'input.valueTiming.repeat.timeOfDay' ||
                columnName === 'output.valueInstant' ||
                columnName === 'output.valueTiming.event' ||
                columnName === 'output.valueTiming.repeat.timeOfDay' ||
                columnName === 'output.valueDateTime') {
                return true;
            }
            break;
        case 'ValueSet':
            if (columnName === 'expansion.timestamp' ||
                columnName === 'expansion.parameter.valueDateTime') {
                return true;
            }
            break;
        case 'VerificationResult':
            if (columnName === 'primarySource.validationDate' ||
                columnName === 'frequency.event') {
                    return true;
            }
            break;
   }

    return false;
}

module.exports = {
    isColumnDateTimeType
};
