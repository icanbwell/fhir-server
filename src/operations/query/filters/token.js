const {tokenQueryBuilder, exactMatchQueryBuilder} = require('../../../utils/querybuilder.util');
const {replaceOrWithNorIfNegation} = require('../../../utils/mongoNegator');

/**
 * Filters by token
 * https://www.hl7.org/fhir/search.html#token
 * @param {string | string[]} queryParameterValue
 * @param {import('../../common/types').SearchParameterDefinition} propertyObj
 * @param {Set} columns
 * @param {boolean} negation
 * @returns {Object[]}
 */
function filterByToken({queryParameterValue, propertyObj, columns, negation}) {
    /**
     * @type {Object[]}
     */
    const and_segments = [];
    if (!Array.isArray(queryParameterValue)) {
        queryParameterValue = [queryParameterValue];
    }
    // https://hl7.org/fhir/search.html#token
    for (const tokenQueryItem of queryParameterValue) {
        if (propertyObj.fieldFilter === '[system/@value=\'email\']') {
            and_segments.push(
                tokenQueryBuilder(
                    {
                        target: tokenQueryItem,
                        type: 'value',
                        field: `${propertyObj.field}`,
                        required: 'email',
                        negation: negation
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
                        required: 'phone',
                        negation: negation
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
                        negation: negation
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
        } else {
            switch (propertyObj.fieldType) {
                // https://hl7.org/fhir/search.html#token
                case 'Coding':
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
                    break;

                case 'CodeableConcept':
                    and_segments.push(
                        tokenQueryBuilder(
                            {
                                target: tokenQueryItem,
                                type: 'code',
                                field: `${propertyObj.field}.coding`,
                                negation: negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.coding.system`);
                    columns.add(`${propertyObj.field}.coding.code`);
                    break;

                case 'Identifier':
                    and_segments.push(
                        tokenQueryBuilder(
                            {
                                target: tokenQueryItem,
                                type: 'value',
                                field: `${propertyObj.field}`,
                                negation: negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.system`);
                    columns.add(`${propertyObj.field}.value`);

                    break;

                case 'ContactPoint':
                    and_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem,
                                field: `${propertyObj.field}.value`,
                                negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}.value`);
                    break;

                case 'code':
                    and_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem,
                                field: `${propertyObj.field}`,
                                negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}`);
                    break;

                case 'boolean':
                    and_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem === 'true' ? true : false,
                                field: `${propertyObj.field}`,
                                negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}`);
                    break;

                case 'uri':
                    and_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem,
                                field: `${propertyObj.field}`,
                                negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}`);
                    break;

                case 'string':
                    and_segments.push(
                        exactMatchQueryBuilder(
                            {
                                target: tokenQueryItem,
                                field: `${propertyObj.field}`,
                                negation
                            }
                        )
                    );
                    columns.add(`${propertyObj.field}`);
                    break;

                default:
                    // can't detect type so use multiple methods
                    and_segments.push(
                        replaceOrWithNorIfNegation(
                            {
                                query: {
                                    $or: [
                                        exactMatchQueryBuilder(
                                            {
                                                target: tokenQueryItem,
                                                field: `${propertyObj.field}`,
                                                negation
                                            }
                                        ),
                                        tokenQueryBuilder(
                                            {
                                                target: tokenQueryItem,
                                                type: 'code',
                                                field: `${propertyObj.field}`,
                                                negation: negation
                                            }
                                        ),
                                        tokenQueryBuilder(
                                            {
                                                target: tokenQueryItem,
                                                type: 'code',
                                                field: `${propertyObj.field}.coding`,
                                                negation: negation
                                            }
                                        ),
                                    ],
                                },
                                negation
                            })
                    );
                    columns.add(`${propertyObj.field}.coding.system`);
                    columns.add(`${propertyObj.field}.coding.code`);
            }
        }
    }
    return and_segments;
}

module.exports = {
    filterByToken
};
