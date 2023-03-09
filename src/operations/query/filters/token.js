const {tokenQueryBuilder, exactMatchQueryBuilder} = require('../../../utils/querybuilder.util');

/**
 * Filters by token
 * https://www.hl7.org/fhir/search.html#token
 * @param {string | string[]} queryParameterValue
 * @param {SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @returns {import('mongodb').Filter<import('mongodb').DefaultSchema>[]}
 */
function filterByToken({queryParameterValue, propertyObj, columns}) {
    /**
     * @type {Object[]}
     */
    const or_segments = [];
    if (!Array.isArray(queryParameterValue)) {
        queryParameterValue = [queryParameterValue];
    }
    // https://hl7.org/fhir/search.html#token
    for (const tokenQueryItem of queryParameterValue) {
        if (propertyObj.fieldFilter === '[system/@value=\'email\']') {
            or_segments.push(
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
            or_segments.push(
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
            or_segments.push(
                tokenQueryBuilder(
                    {
                        target: tokenQueryItem,
                        type: 'value',
                        field: `${propertyObj.field}`
                    }
                )
            );
            columns.add(`${propertyObj.field}.system`);
            columns.add(`${propertyObj.field}.value`);
        } else if (
            propertyObj.field === 'meta.security' ||
            propertyObj.field === 'meta.tag'
        ) {
            // http://www.hl7.org/fhir/search.html#token
            or_segments.push(
                tokenQueryBuilder(
                    {
                        target: tokenQueryItem,
                        type: 'code',
                        field: `${propertyObj.field}`
                    }
                )
            );
            columns.add(`${propertyObj.field}.system`);
            columns.add(`${propertyObj.field}.code`);
        } else {
            switch (propertyObj.fieldType) {
                // https://hl7.org/fhir/search.html#token
                case 'Coding':
                    or_segments.push(
                        tokenQueryBuilder(
                            {
                                target: tokenQueryItem,
                                type: 'code',
                                field: `${propertyObj.field}`
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.system`);
                    columns.add(`${propertyObj.field}.code`);
                    break;

                case 'CodeableConcept':
                    or_segments.push(
                        tokenQueryBuilder(
                            {
                                target: tokenQueryItem,
                                type: 'code',
                                field: `${propertyObj.field}.coding`
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.coding.system`);
                    columns.add(`${propertyObj.field}.coding.code`);
                    break;

                case 'Identifier':
                    or_segments.push(
                        tokenQueryBuilder(
                            {
                                target: tokenQueryItem,
                                type: 'value',
                                field: `${propertyObj.field}`
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.system`);
                    columns.add(`${propertyObj.field}.value`);

                    break;

                case 'ContactPoint':
                    or_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem,
                                field: `${propertyObj.field}.value`
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.value`);
                    break;

                case 'boolean':
                    or_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem === 'true' ? true : false,
                                field: `${propertyObj.field}`
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}`);
                    break;

                case 'code':
                case 'uri':
                case 'string':
                    or_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem,
                                field: `${propertyObj.field}`
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}`);
                    break;

                default:
                    // can't detect type so use multiple methods
                    or_segments.push({
                            $or: [
                                exactMatchQueryBuilder(
                                    {
                                        target: tokenQueryItem,
                                        field: `${propertyObj.field}`
                                    }
                                ),
                                tokenQueryBuilder(
                                    {
                                        target: tokenQueryItem,
                                        type: 'code',
                                        field: `${propertyObj.field}`
                                    }
                                ),
                                tokenQueryBuilder(
                                    {
                                        target: tokenQueryItem,
                                        type: 'code',
                                        field: `${propertyObj.field}.coding`
                                    }
                                ),
                            ],
                        },
                    );
                    columns.add(`${propertyObj.field}.coding.system`);
                    columns.add(`${propertyObj.field}.coding.code`);
            }
        }
    }
    return [{
        $or: or_segments
    }];
}

module.exports = {
    filterByToken
};
