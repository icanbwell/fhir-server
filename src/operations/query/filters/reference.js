const {referenceQueryBuilderOptimized} = require('../../../utils/querybuilder.util');
const {getIndexHints} = require('../../common/getIndexHints');
const {isUuid} = require('../../../utils/uid.util');

/**
 * Filters by reference
 * https://www.hl7.org/fhir/search.html#reference
 * @param {ParsedArgsItem} parsedArg
 * @param {Set} columns
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByReference({parsedArg, columns}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    const propertyObj = parsedArg.propertyObj;


    const fields = propertyObj.fields && Array.isArray(propertyObj.fields) ?
        propertyObj.fields :
        [propertyObj.field];

    /**
     * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    let filter;
    /**
     * @type {boolean}
     */
    const allReferencesAreUuids = parsedArg.references.every(reference => isUuid(reference.id));
    /**
     * @type {boolean}
     */
    const noReferencesAreUuids = !parsedArg.references.some(reference => isUuid(reference.id));
    if (allReferencesAreUuids) {
        //optimize by looking only in _uuid field
        filter = {
            $or: propertyObj.target.flatMap(target =>
                fields.flatMap((field1) =>
                    parsedArg.references.map(reference =>
                        referenceQueryBuilderOptimized({
                                target_type: reference.resourceType || target,
                                target: reference.id,
                                field: `${field1}._uuid`,
                            }
                        )
                    )
                )
            ),
        };
    } else if (noReferencesAreUuids) {
        filter = {
            $or: propertyObj.target.flatMap(target =>
                fields.flatMap((field1) =>
                    parsedArg.references.map(reference =>
                        referenceQueryBuilderOptimized({
                                target_type: reference.resourceType || target,
                                target: reference.id,
                                field: `${field1}._sourceId`,
                            }
                        )
                    )
                )
            ),
        };
    } else {
        // there is a mix of uuids and ids so we have to look in both fields
        filter = {
            $or: propertyObj.target.flatMap(target =>
                fields.flatMap((field1) =>
                    parsedArg.references.flatMap(reference =>
                        [
                            referenceQueryBuilderOptimized({
                                    target_type: reference.resourceType || target,
                                    target: reference.id,
                                    field: `${field1}._sourceId`,
                                }
                            ),
                            referenceQueryBuilderOptimized({
                                    target_type: reference.resourceType || target,
                                    target: reference.id,
                                    field: `${field1}._uuid`,
                                }
                            )
                        ]
                    )
                )
            ),
        };
    }

    if (filter) {
        and_segments.push(filter);
    }
    getIndexHints(columns, propertyObj, 'reference');
    return and_segments;
}

module.exports = {
    filterByReference
};
