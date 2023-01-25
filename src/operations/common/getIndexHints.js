/**
 * Adds fields to columns set, that is to be used as index hints
 * @param {Set} columns
 * @param {SearchParameterDefinition} propertyObj
 * @param {String} fieldName
 */
module.exports.getIndexHints = (columns, propertyObj, fieldName = undefined) => {
    // If property obj contains fields add each one of them to the columns set.
    // If the fieldName is specified add it as a index hint.
    // Example-> propertyObj = [a, b], fieldName=reference => columns = (a.reference, b.reference)
    if ( propertyObj.fields ) {
        propertyObj.fields.forEach(item => columns.add(fieldName ? `${item}.${fieldName}` : item));
    } else {
        // In case of a single field add it to the columns set.
        // If a fieldName is specified add it as a index hint.
        // Example-> propertyObj = a, fieldName=reference => columns = (a.reference)
        columns.add(fieldName ? `${propertyObj.field}.${fieldName}` : propertyObj.field);
    }
};
