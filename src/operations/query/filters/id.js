const {isUuid} = require('../../../utils/uid.util');

const uuidFieldName = '_uuid';
const sourceIdFieldName = '_sourceId';

/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 * @param {string | string[]} queryParameterValue
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {boolean} enableGlobalIdSupport
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterById(
    {
        queryParameterValue,
        propertyObj,
        columns,
        enableGlobalIdSupport
    }
) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (queryParameterValue === undefined || queryParameterValue === null || queryParameterValue.length === 0) {
        return and_segments;
    }
    /**
     * @type {string}
     */
    let field = enableGlobalIdSupport ? sourceIdFieldName : propertyObj.field;

    function getFilterForIdList(idList) {
        let idFilters = [];
        if (idList.some(i => i.includes('|'))) {
            idFilters = idList.map(i => {
                const sourceAssigningAuthority = i.split('|')[0];
                return {
                    $and: [
                        {
                            [`${field}`]: sourceAssigningAuthority,
                        },
                        {
                            ['_sourceAssigningAuthority']: sourceAssigningAuthority
                        }
                    ]
                };
            });
        } else {
            idFilters.push({
                [`${field}`]: {
                    $in: idList,
                }
            });
        }
        return idFilters;
    }

    /**
     * @param {string[]} idAndUuidList
     */
    function getIdFilterForArray({idAndUuidList}) {
        if (!enableGlobalIdSupport) {
            and_segments.push({
                [`${field}`]: {
                    $in: idAndUuidList,
                },
            });
            return;
        }
        // see which ids are uuid
        /**
         * @type {string[]}
         */
        const uuidList = idAndUuidList.filter(i => isUuid(i));
        /**
         * @type {string[]}
         */
        const idList = idAndUuidList.filter(i => !uuidList.includes(i));

        if (idList.length > 0 && uuidList.length > 0) {
            const idFilters = getFilterForIdList(idList);
            idFilters.push({
                [`${uuidFieldName}`]: {
                    $in: uuidList,
                }
            });
            and_segments.push({
                $or: idFilters
            });
        } else if (idList.length > 0) {
            const idFilters = getFilterForIdList(idList);
            and_segments.push({
                $or: idFilters
            });
        } else if (uuidList.length > 0) {
            and_segments.push({
                [`${uuidFieldName}`]: {
                    $in: uuidList,
                },
            });
        }
    }

    if (Array.isArray(queryParameterValue)) {
        getIdFilterForArray({idAndUuidList: queryParameterValue});
        // if array is passed then check in array
    } else if (queryParameterValue.includes(',')) {
        // see if this is a comma separated list
        const value_list = queryParameterValue.split(',');
        getIdFilterForArray({idAndUuidList: value_list});
    } else {
        if (enableGlobalIdSupport && isUuid(queryParameterValue)) {
            field = uuidFieldName;
        }
        if (queryParameterValue.includes('|')) {
            /**
             * @type {string[]}
             */
            const idAndSourceAssigningAuthority = queryParameterValue.split('|');
            if (idAndSourceAssigningAuthority.length > 1) {
                const id = idAndSourceAssigningAuthority[0];
                const sourceAssigningAuthority = idAndSourceAssigningAuthority[1];
                and_segments.push({
                    $and: [
                        {
                            [`${field}`]: id,
                        },
                        {
                            ['_sourceAssigningAuthority']: sourceAssigningAuthority
                        }
                    ]
                });
            }
        } else {
            // single value is passed
            and_segments.push({
                [`${field}`]: queryParameterValue,
            });
        }
    }
    columns.add(`${field}`);
    return and_segments;
}

module.exports = {
    filterById
};
