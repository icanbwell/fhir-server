const {referenceQueryBuilderOptimized} = require('../../../utils/querybuilder.util');
const {isUuid} = require('../../../utils/uid.util');
const {BaseFilter} = require('./baseFilter');

/**
 * Get reference id filter
 * @param {[string]} fields
 * @param {[ParsedReferenceItem]} references
 * @param {string} idField
 * @returns {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function getIdFilter(fields, references, idField) {
    return fields.flatMap(
        field1 => {
            const field = `${field1}.${idField}`;
            const query = references.map(reference =>
                referenceQueryBuilderOptimized({
                        target_type: reference.resourceType,
                        target: reference.id,
                        field: field,
                        sourceAssigningAuthorityField: `${field1}._sourceAssigningAuthority`,
                    },
                ),
            );
            let res = [];
            const directFieldFilterLength = query.filter(q => q[`${field}`]).length;
            if (directFieldFilterLength > 1) {
                res.push(
                    {
                        [`${field}`]: {
                            '$in': query.map(q => q[`${field}`]),
                        },
                    },
                );
            } else if (directFieldFilterLength === 1) {
                res.push(
                    {
                        [`${field}`]: query.map(q => q[`${field}`])[0],
                    },
                );
            }
            query.filter(q => !q[`${field}`]).forEach(q => res.push(q));
            return res;
        },
    );
}

/**
 * @classdesc Filters by reference
 * https://www.hl7.org/fhir/search.html#reference
 */
class FilterByReference extends BaseFilter {
    /**
     * filter function that calls filterByItem for each field and each value supplied
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filter() {
        /**
         * @type {Object[]}
         */
        const and_segments = [];
        const propertyObj = this.propertyObj;


        const fields = this.propertyObj.fields;

        /**
         * @type {import('mongodb').Filter<import('mongodb').DefaultSchema>}
         */
        let filter;
        /**
         * @type {boolean}
         */
        const allReferencesAreUuids = this.parsedArg.references.every(reference => isUuid(reference.id));
        /**
         * @type {boolean}
         */
        const noReferencesAreUuids = !this.parsedArg.references.some(reference => isUuid(reference.id));
        if (allReferencesAreUuids) {
            //optimize by looking only in _uuid field
            filter = {
                $or: getIdFilter(fields, this.parsedArg.references, '_uuid'),
            };
        } else if (noReferencesAreUuids) {
            filter = {
                $or:
                    getIdFilter(fields, this.parsedArg.references, '_sourceId'),
            };
        } else {
            // there is a mix of uuids and ids so we have to look in both fields
            filter = {
                $or: propertyObj.target.flatMap(target =>
                    fields.flatMap((field1) =>
                        this.parsedArg.references.flatMap(reference =>
                            [
                                referenceQueryBuilderOptimized({
                                        target_type: reference.resourceType || target,
                                        target: reference.id,
                                        field: `${field1}._sourceId`,
                                        sourceAssigningAuthorityField: `${field1}._sourceAssigningAuthority`
                                    }
                                ),
                                referenceQueryBuilderOptimized({
                                        target_type: reference.resourceType || target,
                                        target: reference.id,
                                        field: `${field1}._uuid`,
                                        sourceAssigningAuthorityField: `${field1}._sourceAssigningAuthority`
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
        return and_segments;

    }
}


module.exports = {
    FilterByReference
};
