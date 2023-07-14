/**
 * converts graphql parameters to standard FHIR parameters
 * @param {string | string[] | Object} queryParameterValue
 * @param {Object} args
 * @param {string} queryParameter
 * @return {Object}
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
                    // parse out notEquals values
                    if (queryParameterValue['notEquals']) {
                        const notEqualsObject = queryParameterValue['notEquals'];
                        if (notEqualsObject['value']) {
                            queryParameterValue['value'] = notEqualsObject['value'];
                        } else if (notEqualsObject['values']) {
                            queryParameterValue['values'] = notEqualsObject['values'];
                        }
                        queryParameter = `${queryParameter}:not`;
                    }
                    // handle SearchString
                    if (queryParameterValue['value']) {
                        queryParameterValue = queryParameterValue['value'];
                    } else if (queryParameterValue['values']) {
                        queryParameterValue = queryParameterValue['values'];
                    }
                    break;
                case 'token':
                    // parse out notEquals values
                    if (queryParameterValue['notEquals']) {
                        const notEqualsObject = queryParameterValue['notEquals'];
                        if (notEqualsObject['value']) {
                            queryParameterValue['value'] = notEqualsObject['value'];
                        } else if (notEqualsObject['values']) {
                            queryParameterValue['values'] = notEqualsObject['values'];
                        }
                        queryParameter = `${queryParameter}:not`;
                    }
                    if (queryParameterValue['value']) {
                        // noinspection JSValidateTypes
                        queryParameterValue['values'] = [queryParameterValue['value']];
                    }
                    if (queryParameterValue['values']) {
                        for (let token of queryParameterValue['values']) {
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
                    if (queryParameterValue['notEquals']) {
                        const notEqualsObject = queryParameterValue['notEquals'];
                        if (notEqualsObject['value']) {
                            queryParameterValue['value'] = notEqualsObject['value'];
                        } else if (notEqualsObject['target']) {
                            queryParameterValue['target'] = notEqualsObject['target'];
                        }
                        queryParameter = `${queryParameter}:not`;
                    }
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
                    if (queryParameterValue['notEquals']) {
                        const notEqualsObject = queryParameterValue['notEquals'];
                        if (notEqualsObject['prefix']) {
                            queryParameterValue['prefix'] = notEqualsObject['prefix'];
                        }
                        if (notEqualsObject['value']) {
                            queryParameterValue['value'] = notEqualsObject['value'];
                        }
                        if (notEqualsObject['system']) {
                            queryParameterValue['system'] = notEqualsObject['system'];
                        }
                        if (notEqualsObject['code']) {
                            queryParameterValue['code'] = notEqualsObject['code'];
                        }
                        queryParameter = `${queryParameter}:not`;
                    }
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
                        // noinspection JSValidateTypes
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
                default:
                    break;
            }
            if (queryParameterValue['missing']) {
                args[`${queryParameter}:missing`] = queryParameterValue['missing'];
            }
        }
    }
    return {queryParameter, queryParameterValue};
}

module.exports = {
    convertGraphQLParameters: convertGraphQLParameters
};
