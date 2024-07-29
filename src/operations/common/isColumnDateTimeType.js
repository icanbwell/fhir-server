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
    if (columnName === 'meta.lastUpdated') {
        return true;
    }

    const pattern = /instant/i;
    if (pattern.test(columnName)) {
        return true;
    }

    switch (resourceType) {
        case 'AuditEvent':
            if (columnName === 'recorded') {
                return true;
            }
            break;
        case 'Appointment':
            if (columnName === 'start' ||
                columnName === 'end') {
                return true;
            }
            break;
        case 'AppointmentResponse':
            if (columnName === 'start' ||
                columnName === 'end') {
                return true;
            }
            break;
        case 'Bundle':
            if (columnName === 'timestamp' ||
                columnName === 'signature.when' ||
                columnName === 'entry.request.ifModifiedSince' ||
                columnName === 'entry.response.lastModified') {
                return true;
            }
            break;
        case 'DeviceMetric':
            if (columnName === 'calibration.time') {
                return true;
            }
            break;
        case 'DiagnosticReport':
            if (columnName === 'issued') {
                return true;
            }
            break;
        case 'DocumentReference':
            if (columnName === 'date') {
                return true;
            }
            break;
        case 'Media':
            if (columnName === 'issued') {
                return true;
            }
            break;
        case 'Observation':
            if (columnName === 'issued') {
                return true;
            }
            break;
        case 'Provenance':
            if (columnName === 'recorded' ||
                columnName === 'signature.when') {
                return true;
            }
            break;
        case 'Slot':
            if (columnName === 'start' ||
                columnName === 'end') {
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
    }
    return false;
}

module.exports = {
    isColumnDateTimeType
};
