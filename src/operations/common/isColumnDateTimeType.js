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
            if (columnName === 'timingDateTime') {
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
            if (columnName === 'start' ||
                columnName === 'end' ||
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
                columnName === 'processing.timeDateTime') {
                return true;
            }
            break;
        case 'Bundle':
            if (columnName === 'timestamp') {
                return true;
            }
            break;
       case 'ChargeItem':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'ClinicalImpression':
            if (columnName === 'effectiveDateTime') {
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
            if (columnName === 'dateTime') {
                return true;
            }
            break;
        case 'Contract':
            if (columnName === 'term.action.occurrenceDateTime' ||
                columnName === 'term.asset.answer.valueDateTime' ||
                columnName === 'term.asset.answer.valueDate' ||
                columnName === 'term.offer.answer.valueDateTime') {
                return true;
            }
            break;
        case 'DetectedIssue':
            if (columnName === 'identifiedDateTime') {
                return true;
            }
            break;
        case 'DeviceRequest':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'DeviceUseStatement':
            if (columnName === 'timingDateTime') {
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
            if (columnName === 'characteristic.participantEffectiveDateTime') {
                return true;
            }
            break;
        case 'GuidanceResponse':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'Immunization':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'Media':
            if (columnName === 'createdDateTime' ||
                columnName === 'issued') {
                return true;
            }
            break;
        case 'MedicationAdministration':
            if (columnName === 'effectiveDateTime') {
                return true;
            }
            break;
        case 'MedicationStatement':
            if (columnName === 'effectiveDateTime') {
                return true;
            }
            break;
        case 'NutritionOrder':
            if (columnName === 'dateTime') {
                return true;
            }
            break;
        case 'Observation':
            if (columnName === 'effectiveDateTime' ||
                columnName === 'valueDateTime' ||
                columnName === 'effectiveInstant' ||
                columnName === 'issued' ||
                columnName === 'component.valueDateTime') {
                return true;
            }
            break;
        case 'Parameters':
            if (columnName === 'parameter.valueDateTime') {
                return true;
            }
            break;
        case 'Patient':
            if (columnName === 'deceasedDateTime') {
                return true;
            }
            break;
        case 'PlanDefinition':
            if (columnName === 'action.timingDateTime') {
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
            if (columnName === 'action.timingDateTime') {
                return true;
            }
            break;
        case 'ResearchElementDefinition':
            if (columnName === 'characteristic.studyEffectiveDateTime' ||
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
            if (columnName === 'occurrenceDateTime') {
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
        case 'StructureMap':
            if (columnName === 'group.rule.source.defaultValueDateTime') {
                return true;
            }
            break;
        case 'Subscription':
            if (columnName === 'end') {
                return true;
            }
            break;
        case 'SupplyDelivery':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'SupplyRequest':
            if (columnName === 'occurrenceDateTime') {
                return true;
            }
            break;
        case 'Task':
            if (columnName === 'input.valueDateTime' ||
                columnName === 'output.valueDateTime') {
                return true;
            }
            break;
        case 'ValueSet':
            if (columnName === 'expansion.parameter.valueDateTime') {
                return true;
            }
            break;
   }

    return false;
}

module.exports = {
    isColumnDateTimeType
};
