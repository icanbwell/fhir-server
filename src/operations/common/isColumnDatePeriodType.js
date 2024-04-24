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
            if (columnName === 'dosageInstruction.timing.repeat.boundsPeriod' ||
                columnName === 'dispenseRequest.validityPeriod') {
                return true;
            }
            break;
        case 'MedicationStatement':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'MedicinalProductAuthorization':
            if (columnName === 'validityPeriod' ||
                columnName === 'dataExclusivityPeriod' ||
                columnName === 'jurisdictionalAuthorization.validityPeriod' ||
                columnName === 'procedure.datePeriod') {
                return true;
            }
            break;
       case 'NamingSystem':
            if (columnName === 'uniqueId.period') {
                return true;
            }
            break;
        case 'NutritionOrder':
            if (columnName === 'enteralFormula.administration.schedule.repeat.boundsPeriod' ||
                columnName === 'oralDiet.schedule.repeat.boundsPeriod' ||
                columnName === 'supplement.schedule.repeat.boundsPeriod') {
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
        case 'OrganizationAffiliation':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'Parameters':
            if (columnName === 'parameter.valuePeriod' ||
                columnName === 'parameter.valueTiming.repeat.boundsPeriod') {
                return true;
            }
            break;
        case 'Patient':
            if (columnName === 'contact.period') {
                return true;
            }
            break;
        case 'PlanDefinition':
            if (columnName === 'effectivePeriod' ||
                columnName === 'action.timingPeriod' ||
                columnName === 'action.timingTiming.repeat.boundsPeriod') {
                return true;
            }
            break;
        case 'Practitioner':
            if (columnName === 'qualification.period') {
                return true;
            }
            break;
        case 'PractitionerRole':
            if (columnName === 'period' ||
                columnName === 'notAvailable.during') {
                return true;
            }
            break;
        case 'Procedure':
            if (columnName === 'performedPeriod') {
                return true;
            }
            break;
        case 'Provenance':
            if (columnName === 'occurredPeriod') {
                return true;
            }
            break;
        case 'Questionaire':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'RelatedPerson':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'RequestGroup':
            if (columnName === 'action.timingTiming.repeat.boundsPeriod' ||
               columnName === 'action.timingPeriod') {
                return true;
            }
            break;
        case 'ResearchDefinition':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'ResearchElementDefinition':
            if (columnName === 'effectivePeriod' ||
                columnName === 'characteristic.studyEffectivePeriod' ||
                columnName === 'characteristic.studyEffectiveTiming.repeat.boundsPeriod' ||
                columnName === 'characteristic.participantEffectivePeriod' ||
                columnName === 'characteristic.participantEffectiveTiming.repeat.boundsPeriod') {
                return true;
            }
           break;
        case 'ResearchStudy':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'ResearchSubject':
            if (columnName === 'period') {
                return true;
            }
            break;
        case 'RiskAssessment':
            if (columnName === 'occurrencePeriod' ||
                columnName === 'prediction.whenPeriod') {
                return true;
            }
            break;
        case 'RiskEvidenceSynthesis':
            if (columnName === 'effectivePeriod') {
                return true;
            }
            break;
        case 'Schedule':
            if (columnName === 'planningHorizon') {
                return true;
            }
            break;
        case 'ServiceRequest':
            if (columnName === 'occurrencePeriod') {
                return true;
            }
            break;
        case 'Specimen':
            if (columnName === 'collection.collectedPeriod' ||
                columnName === 'processing.timePeriod') {
                return true;
            }
            break;
       case 'StructureMap':
            if (columnName === 'group.rule.source.defaultValuePeriod' ||
                columnName === 'group.rule.source.defaultValueTiming.repeat.boundsPeriod') {
                return true;
            }
            break;
        case 'SupplyDelivery':
            if (columnName === 'occurrencePeriod') {
                return true;
            }
            break;
        case 'SupplyRequest':
            if (columnName === 'occurrencePeriod') {
                return true;
            }
            break;
        case 'Task':
            if (columnName === 'executionPeriod' ||
                columnName === 'input.valueTiming.repeat.boundsPeriod' ||
                columnName === 'input.valuePeriod' ||
                columnName === 'output.valueTiming.repeat.boundsPeriod' ||
                columnName === 'output.valuePeriod' ||
                columnName === 'restriction.period') {
                return true;
            }
            break;
   }

    return false;
}

module.exports = {
    isColumnDatePeriodType
};
