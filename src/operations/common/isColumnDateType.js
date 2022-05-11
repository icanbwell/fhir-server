function isColumnDateType(resourceType, columnName) {
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
