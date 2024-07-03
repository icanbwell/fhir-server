/**
 * returns the resources that contain Instant (datetime) type fields
 * @param {string} resourceType
 * @returns {boolean}
 */
function resourcesWithDateTimeFields (resourceType) {
    const resources = [
        'AuditEvent'
        , 'Appointment'
        , 'AppointmentResponse'
        , 'Bundle'
        , 'DeviceMetric'
        , 'DiagnosticReport'
        , 'DocumentReference'
        , 'Media'
        , 'Observation'
        , 'Parameters'
        , 'Provenance'
        , 'Slot'
        , 'StructureDefinition'
        , 'StructureMap'
        , 'Subscription'
        , 'SubscriptionStatus'
        , 'Substance'
        , 'Task'];
    return resources.contains(resourceType);
}

module.exports = {
    resourcesWithDateTimeFields
};
