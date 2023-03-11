const {isUuid} = require('../../../utils/uid.util');

const uuidFieldName = '_uuid';
const sourceIdFieldName = '_sourceId';

/**
 * Filters by id
 * https://www.hl7.org/fhir/search.html#id
 * @param {ParsedArgsItem} parsedArg
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {boolean} enableGlobalIdSupport
 * @param {boolean|undefined} useHistoryTable
 * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterById(
    {
        parsedArg,
        propertyObj,
        // eslint-disable-next-line no-unused-vars
        columns,
        enableGlobalIdSupport,
        useHistoryTable
    }
) {
    /**
     * @type {string[]}
     */
    const queryParameterValues = parsedArg.queryParameterValue.values;
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (queryParameterValues.length === 0) {
        return and_segments;
    }
    /**
     * @type {string}
     */
    let field = enableGlobalIdSupport ? sourceIdFieldName : propertyObj.field;

    /**
     * Gets field name.  In case of useHistoryTable, prepends the field namewith 'resource.' since in history
     * we store data as a BundleEntry
     * @param {string} fieldName
     */
    function getFullFieldName(fieldName) {
        return useHistoryTable ?
            `resource.${fieldName}` :
            fieldName;
    }

    function getFilterForIdList(idList) {
        let idFilters = [];
        if (idList.some(i => i.includes('|'))) {
            idFilters = idList.map(i => {
                const id = i.split('|')[0];
                const sourceAssigningAuthority = i.split('|')[1];
                return {
                    $and: [
                        {
                            [getFullFieldName(field)]: id,
                        },
                        {
                            [getFullFieldName('_sourceAssigningAuthority')]: sourceAssigningAuthority
                        }
                    ]
                };
            });
        } else {
            idFilters.push({
                [getFullFieldName(field)]: {
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
                [getFullFieldName(field)]: {
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
                [getFullFieldName(uuidFieldName)]: {
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
                [getFullFieldName(uuidFieldName)]: {
                    $in: uuidList,
                },
            });
        }
    }

    getIdFilterForArray({idAndUuidList: queryParameterValues});
    // if array is passed then check in array

    return and_segments;
}

module.exports = {
    filterById
};
