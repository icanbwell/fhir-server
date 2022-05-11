function isColumnDateType(resourceType, columnName) {
    // TODO: for now hardcoded for AuditEvent but later we should generate from fhir schema for all date properties
    if (resourceType && resourceType === 'AuditEvent') {
        if (columnName === 'recorded') {
            return true;
        }
    }
    return false;
}

module.exports = {
    isColumnDateType: isColumnDateType
};
