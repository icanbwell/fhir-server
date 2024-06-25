/**
 * returns the columns in the specified resource of DateTime type
 * also covers instant type
 * @param {string} resourceType
 * @returns {string[]}
 */
function resourcesWithDateTimeFields (resourceType) {
    if (!resourceType) {
        return [];
    }
    switch (resourceType) {
        case 'AuditEvent':
             return ['recorded'];
        case 'Appointment':
            return ['start','end'];
        case 'AppointmentResponse':
            return ['start', 'end'];
        case 'Bundle':
            return ['timeStamp', 'signature.when', 'entry.request.ifModifiedSince','entry.response.lastModified'];
        case 'DeviceMetric':
            return ['calibration.time'];
        case 'DiagnosticReport':
            return ['issued'];
        case 'DocumentReference':
            return ['date'];
        case 'Media':
            return ['issued'];
        case 'Observation':
            return ['issued', 'effectiveInstant'];
        case 'Parameters':
            return ['parameter.valueInstant'];
        case 'Provenance':
            return ['recorded', 'signature.when'];
        case 'Slot':
            return ['start', 'end'];
        case 'StructureDefinition':
            return ['snapshot.element.defaultValueInstant', 'snapshot.element.fixedInstant', 'snapshot.element.patternInstant',
                    'snapshot.element.minvalueInstant', 'snapshot.element.maxValueInstant', 'snapshot.element.example.valueInstant',
                    'differential.element.defaultValueInstant', 'differential.element.fixedInstant', 'differential.element.patternInstant',
                    'differential.element.minValueInstant', 'differential.element.example.valueInstant', 'differential.element.maxValueInstant'];
        case 'StructureMap':
            return ['group.rule.source.defaultValueInstant'];
        case 'Subscription':
            return ['end'];
        case 'SubscriptionStatus':
            return ['notificationEvent.timestamp'];
        case 'Substance':
            return ['instance.expiry'];
        case 'Task':
            return ['input.valueInstant', 'output.valueInstant'];
    }
    return [];
}

module.exports = {
    resourcesWithDateTimeFields
};
