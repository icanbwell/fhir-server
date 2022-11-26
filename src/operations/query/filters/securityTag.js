const {tokenQueryBuilder} = require('../../../utils/querybuilder.util');
const {SecurityTagSystem} = require('../../../utils/securityTagSystem');

/**
 * Filters by token
 * https://www.hl7.org/fhir/search.html#token
 * @param {string | string[]} queryParameterValue
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {function(code): boolean} fnUseAccessIndex function that returns whether to use access index for this code
 * @param {boolean} negation
 * @returns {Object[]}
 */
function filterBySecurityTag(
    {
        queryParameterValue,
        propertyObj,
        columns,
        fnUseAccessIndex,
        negation
    }) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (!Array.isArray(queryParameterValue)) {
        queryParameterValue = [queryParameterValue];
    }
    for (const tokenQueryItem of queryParameterValue) {
        if (propertyObj.fieldFilter === '[system/@value=\'email\']') {
            and_segments.push(
                tokenQueryBuilder(
                    {
                        target: tokenQueryItem,
                        type: 'value',
                        field: `${propertyObj.field}`,
                        required: 'email'
                    }
                )
            );
            columns.add(`${propertyObj.field}.system`);
            columns.add(`${propertyObj.field}.value`);
        } else if (propertyObj.fieldFilter === '[system/@value=\'phone\']') {
            and_segments.push(
                tokenQueryBuilder(
                    {
                        target: tokenQueryItem,
                        type: 'value',
                        field: `${propertyObj.field}`,
                        required: 'phone'
                    }
                )
            );
            columns.add(`${propertyObj.field}.system`);
            columns.add(`${propertyObj.field}.value`);
        } else if (propertyObj.field === 'identifier') {
            // http://www.hl7.org/fhir/search.html#token
            and_segments.push(
                tokenQueryBuilder(
                    {
                        target: tokenQueryItem,
                        type: 'value',
                        field: `${propertyObj.field}`,
                    }
                )
            );
            columns.add(`${propertyObj.field}.system`);
            columns.add(`${propertyObj.field}.value`);
        } else if (
            propertyObj.field === 'meta.security' ||
            propertyObj.field === 'meta.tag'
        ) {
            /**
             * @type {string}
             */
            const decodedTokenQueryItem = decodeURIComponent(tokenQueryItem);
            if (decodedTokenQueryItem.includes('|')) {
                const [system, value] = decodedTokenQueryItem.split('|');
                if (system === SecurityTagSystem.access && fnUseAccessIndex(value)) {
                    // http://www.hl7.org/fhir/search.html#token
                    const field = `_access.${value}`;
                    if (negation) {
                        and_segments.push(
                            {
                                [field]: {$ne: 1}
                            });
                    } else {
                        and_segments.push(
                            {
                                [field]: 1
                            });
                    }

                    columns.add(`${field}`);
                } else {
                    and_segments.push(
                        tokenQueryBuilder(
                            {
                                target: tokenQueryItem,
                                type: 'code',
                                field: `${propertyObj.field}`,
                                negation: negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.system`);
                    columns.add(`${propertyObj.field}.code`);
                }
            } else {
                // http://www.hl7.org/fhir/search.html#token
                and_segments.push(
                    tokenQueryBuilder(
                        {
                            target: tokenQueryItem,
                            type: 'code',
                            field: `${propertyObj.field}`,
                        }
                    )
                );
                columns.add(`${propertyObj.field}.system`);
                columns.add(`${propertyObj.field}.code`);
            }

        } else {
            and_segments.push({
                $or: [
                    tokenQueryBuilder(
                        {
                            target: tokenQueryItem,
                            type: 'code',
                            field: `${propertyObj.field}`,
                        }
                    ),
                    tokenQueryBuilder(
                        {
                            target: tokenQueryItem,
                            type: 'code',
                            field: `${propertyObj.field}.coding`,
                        }
                    ),
                ],
            });
            columns.add(`${propertyObj.field}.coding.system`);
            columns.add(`${propertyObj.field}.coding.code`);
        }
    }
    return and_segments;
}

module.exports = {
    filterBySecurityTag
};
