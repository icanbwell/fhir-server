/**
 * converts graphql parameters to standard FHIR parameters
 * @param {string | string[] | Object} queryParameterValue
 * @param {Object} args
 * @param {string} queryParameter
 * @return {string | string[]}
 */
function convertGraphQLParameters(queryParameterValue, args, queryParameter) {
    if (queryParameterValue) {
        // un-bundle any objects coming from graphql
        if (
            typeof queryParameterValue === 'object' &&
            !Array.isArray(queryParameterValue) &&
            queryParameterValue['searchType']
        ) {
            switch (queryParameterValue['searchType']) {
                case 'string':
                    // handle SearchString
                    if (queryParameterValue['value']) {
                        queryParameterValue = queryParameterValue['value'];
                    } else if (queryParameterValue['values']) {
                        queryParameterValue = queryParameterValue['values'];
                    }
                    break;
                case 'token':
                    if (queryParameterValue['value']) {
                        queryParameterValue['values'] = [queryParameterValue['value']];
                    }
                    if (queryParameterValue['values']) {
                        for (const token of queryParameterValue['values']) {
                            queryParameterValue = [];
                            let tokenString = '';
                            if (token['system']) {
                                tokenString = token['system'] + '|';
                            }
                            if (token['code']) {
                                tokenString += token['code'];
                            }
                            if (token['value']) {
                                tokenString += token['value'];
                            }
                            if (tokenString) {
                                queryParameterValue.push(tokenString);
                            }
                        }
                    }
                    break;
                case 'reference':
                    // eslint-disable-next-line no-case-declarations
                    let referenceText = '';
                    if (queryParameterValue['target']) {
                        referenceText = queryParameterValue['target'] + '/';
                    }
                    if (queryParameterValue['value']) {
                        referenceText += queryParameterValue['value'];
                    }
                    queryParameterValue = referenceText;
                    break;
                case 'quantity':
                    // eslint-disable-next-line no-case-declarations
                    let quantityString = '';
                    if (queryParameterValue['prefix']) {
                        quantityString += queryParameterValue['prefix'];
                    }
                    if (queryParameterValue['value']) {
                        quantityString += queryParameterValue['value'];
                    }
                    if (queryParameterValue['system']) {
                        quantityString = '|' + queryParameterValue['system'];
                    }
                    if (queryParameterValue['code']) {
                        quantityString = '|' + queryParameterValue['code'];
                    }
                    queryParameterValue = quantityString;
                    break;
                case 'date':
                case 'dateTime':
                case 'number':
                    if (queryParameterValue['value']) {
                        queryParameterValue['values'] = [queryParameterValue['value']];
                    }
                    if (queryParameterValue['values']) {
                        const numberValues = [];
                        for (const dateValue of queryParameterValue['values']) {
                            queryParameterValue = [];
                            let dateString = '';
                            if (dateValue['equals']) {
                                dateString = 'eq' + dateValue['equals'];
                            }
                            if (dateValue['notEquals']) {
                                dateString = 'ne' + dateValue['notEquals'];
                            }
                            if (dateValue['greaterThan']) {
                                dateString = 'gt' + dateValue['greaterThan'];
                            }
                            if (dateValue['greaterThanOrEqualTo']) {
                                dateString = 'ge' + dateValue['greaterThanOrEqualTo'];
                            }
                            if (dateValue['lessThan']) {
                                dateString = 'lt' + dateValue['lessThan'];
                            }
                            if (dateValue['lessThanOrEqualTo']) {
                                dateString = 'le' + dateValue['lessThanOrEqualTo'];
                            }
                            if (dateValue['startsAfter']) {
                                dateString = 'sa' + dateValue['startsAfter'];
                            }
                            if (dateValue['endsBefore']) {
                                dateString = 'eb' + dateValue['endsBefore'];
                            }
                            if (dateValue['approximately']) {
                                dateString = 'ap' + dateValue['approximately'];
                            }
                            if (dateString) {
                                numberValues.push(dateString);
                            }
                        }
                        if (numberValues.length > 0) {
                            queryParameterValue = queryParameterValue.concat(numberValues);
                        }
                    }
                    break;
            }
            if (queryParameterValue['missing'] !== null) {
                args[`${queryParameter}:missing`] = queryParameterValue['missing'];
            }
        }
    }
    return queryParameterValue;
}

module.exports = {
    convertGraphQLParameters: convertGraphQLParameters
};
