const {BaseFilter} = require('./baseFilter');
const {ReferenceParser} = require('../../../utils/referenceParser');
const {groupByLambda} = require('../../../utils/list.util');
const { generateUUIDv5 } = require('../../../utils/uid.util');

/**
 * @classdesc Filters by reference
 * https://www.hl7.org/fhir/search.html#reference
 */
class FilterByReference extends BaseFilter {
    constructor(filterParameters) {
        super(filterParameters);
    }

    /**
     * Get references
     * @param {string[]} targets
     * @param {string} reference
     * @return {string[]}
     */
    getReferences({targets, reference}) {
        const {resourceType, id} = ReferenceParser.parseReference(reference);
        if (resourceType) {
            return [
                ReferenceParser.createReference(
                    {
                        resourceType: resourceType, id: id // do not set sourceAssigningAuthority since we set that as a separate $and clause
                    }
                )
            ];
        } else {
            return targets.map(
                t => ReferenceParser.createReference(
                    {
                        resourceType: t, id: id // do not set sourceAssigningAuthority since we set that as a separate $and clause
                    }
                )
            );
        }
    }

    buildUuids(sourceAssigningAuthority, references) {
        let uuids = [];
        if (sourceAssigningAuthority && sourceAssigningAuthority.length > 0) {
            const newArray = references.flatMap( r => {
                    const parsedRef = ReferenceParser.parseReference(r);
                    const uuid = generateUUIDv5(`${parsedRef.id}${sourceAssigningAuthority ? '|' : ''}${sourceAssigningAuthority}`);
                    return this.getReferences({
                        targets: this.propertyObj.target,
                        reference: `${parsedRef.resourceType}/${uuid}`
                    });
                }
            );
            uuids = uuids.concat(newArray);
        }
        return uuids;
    }

    /**
     * filter function that calls filterByItem for each field and each value supplied
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
     */
    filter() {
        /**
         * @type {Object[]}
         */
        const and_segments = [];

        if (!this.parsedArg.queryParameterValue.values || this.parsedArg.queryParameterValue.values.length === 0) {
            return and_segments;
        }

        const filters = [];

        // separate uuids and ids
        const uuidReferences = this.parsedArg.queryParameterValue.values.filter(r => ReferenceParser.isUuidReference(r));

        if (uuidReferences.length > 0) {
            // process uuids first
            const uuidFilters = [];
            for (const field of this.propertyObj.fields) {
                uuidFilters.push(
                    {
                        [`${field}._uuid`]: {
                            '$in': uuidReferences.flatMap(
                                r => this.getReferences(
                                    {
                                        targets: this.propertyObj.target,
                                        reference: r
                                    }
                                )
                            )
                        }
                    }
                );

                if (uuidFilters.length > 0) {
                    filters.push({
                        '$or': uuidFilters
                    });
                }
            }
        }
        // process ids next
        const idReferences = this.parsedArg.queryParameterValue.values.filter(r => !ReferenceParser.isUuidReference(r));
        if (idReferences.length > 0) {
            const idFilters = [];
            let uuids = [];
            for (const field of this.propertyObj.fields) {
                const idReferencesWithSourceAssigningAuthority = idReferences.filter(r => ReferenceParser.getSourceAssigningAuthority(r));
                const idReferencesWithoutSourceAssigningAuthority = idReferences.filter(r => !ReferenceParser.getSourceAssigningAuthority(r));
                if (idReferencesWithSourceAssigningAuthority.length > 0) {
                    // group by sourceAssigningAuthority
                    const idReferencesWithResourceTypeAndSourceAssigningAuthorityGroups = groupByLambda(
                        idReferencesWithSourceAssigningAuthority,
                        r => ReferenceParser.getSourceAssigningAuthority(r)
                    );
                    for (
                        const [sourceAssigningAuthority, references] of
                        Object.entries(idReferencesWithResourceTypeAndSourceAssigningAuthorityGroups)
                    )
                    {
                        const refWithoutResourceType = references.filter( r => !ReferenceParser.getResourceType(r));
                        if (refWithoutResourceType.length > 0) {
                            idFilters.push(
                                {
                                    '$and': [
                                        {
                                            [`${field}._sourceAssigningAuthority`]: sourceAssigningAuthority
                                        },
                                        {
                                            [`${field}._sourceId`]: {
                                                '$in': refWithoutResourceType.flatMap(
                                                    r => this.getReferences({
                                                        targets: this.propertyObj.target,
                                                        reference: r
                                                    })
                                                )
                                            }
                                        }
                                    ]
                                }
                            );
                        }

                        const refWithResourceType = references.filter( r => ReferenceParser.getResourceType(r));
                        if (refWithResourceType.length > 0) {
                            uuids = uuids.concat(this.buildUuids(sourceAssigningAuthority, refWithResourceType));
                        }
                    }
                }
                if (idReferencesWithoutSourceAssigningAuthority.length > 0) {
                    idFilters.push(
                        {
                            [`${field}._sourceId`]: {
                                '$in': idReferencesWithoutSourceAssigningAuthority.flatMap(
                                    r => this.getReferences({
                                        targets: this.propertyObj.target,
                                        reference: r
                                    })
                                )
                            }
                        }
                    );
                }
                if (uuids.length > 0) {
                    idFilters.push(
                        {
                            [`${field}._uuid`]: {
                                '$in': uuids
                            }
                        }
                    );
                }
                if (idFilters.length > 0) {
                    filters.push({
                        '$or': idFilters
                    });
                }

            }
        }
        const filter = {
            '$or': filters
        };
        and_segments.push(filter);
        return and_segments;
    }
}


module.exports = {
    FilterByReference
};
