/**
 * converts graphql parameters to standard FHIR parameters
 * @param {string | string[] | Object} queryParameterValue
 * @param {Object} args
 * @param {string} queryParameter
 * @return {Object}
 */
function convertGraphQLParameters (queryParameterValue, args, queryParameter) {
    let notQueryParameterValue, orQueryParameterValue = [], andQueryParameterValue = [];
    // un-bundle any objects coming from graphql
    if (
        queryParameterValue &&
        typeof queryParameterValue === 'object' &&
        !Array.isArray(queryParameterValue) &&
        queryParameterValue.searchType
    ) {
        let useNotEquals = false;
        switch (queryParameterValue.searchType) {
            case 'string':
                // parse out notEquals values
                if (queryParameterValue.notEquals) {
                    const notEqualsObject = queryParameterValue.notEquals;
                    notQueryParameterValue = notEqualsObject.value || notEqualsObject.values;
                    queryParameterValue = [];
                } else {
                    // handle SearchString
                    orQueryParameterValue = queryParameterValue.value || queryParameterValue.values;
                }
                break;
            case 'token':
                if (queryParameterValue.value) {
                    // noinspection JSValidateTypes
                    queryParameterValue.values = [queryParameterValue.value];
                }
                if (queryParameterValue.notEquals) {
                    // noinspection JSValidateTypes
                    queryParameterValue.values = [queryParameterValue.notEquals];
                    useNotEquals = true;
                }
                // eslint-disable-next-line no-case-declarations
                const newQueryParameterValue = [];
                notQueryParameterValue = [];
                if (queryParameterValue.values) {
                    for (const token of queryParameterValue.values) {
                        let tokenToProcess = token;
                        let innerNotEquals = false;
                        if (tokenToProcess.notEquals) {
                            tokenToProcess = token.notEquals;
                            innerNotEquals = true;
                        }
                        let tokenString = '';
                        if (tokenToProcess.system) {
                            tokenString = tokenToProcess.system + '|';
                        }
                        if (tokenToProcess.code) {
                            tokenString += tokenToProcess.code;
                        }
                        if (tokenToProcess.value) {
                            tokenString += tokenToProcess.value;
                        }

                        // for extension type
                        if (tokenToProcess.url) {
                            tokenString = tokenToProcess.url + '|';
                        }
                        if (tokenToProcess.valueString) {
                            tokenString += tokenToProcess.valueString;
                        }

                        if (tokenString) {
                            if (useNotEquals || innerNotEquals) {
                                notQueryParameterValue.push(tokenString);
                            } else {
                                newQueryParameterValue.push(tokenString);
                            }
                        }
                    }
                }
                orQueryParameterValue = newQueryParameterValue;
                break;
            case 'reference':
                // eslint-disable-next-line no-case-declarations
                let referenceText = '';
                if (queryParameterValue.notEquals) {
                    const notEqualsObject = queryParameterValue.notEquals;
                    if (notEqualsObject.value) {
                        queryParameterValue.value = notEqualsObject.value;
                    }
                    if (notEqualsObject.target) {
                        queryParameterValue.target = notEqualsObject.target;
                    }
                    useNotEquals = true;
                }
                if (queryParameterValue.target) {
                    referenceText = queryParameterValue.target + '/';
                }
                if (queryParameterValue.value) {
                    referenceText += queryParameterValue.value;
                }
                if (useNotEquals) {
                    notQueryParameterValue = referenceText;
                    queryParameterValue = [];
                } else {
                    orQueryParameterValue = referenceText;
                }
                break;
            case 'quantity':
                // eslint-disable-next-line no-case-declarations
                let quantityString = '';
                if (queryParameterValue.notEquals) {
                    const notEqualsObject = queryParameterValue.notEquals;
                    Object.keys(notEqualsObject).forEach(key => {
                        queryParameterValue[key] = notEqualsObject[key];
                    });
                    useNotEquals = true;
                }
                if (queryParameterValue.prefix) {
                    quantityString += queryParameterValue.prefix;
                }
                if (queryParameterValue.value) {
                    quantityString += queryParameterValue.value;
                }
                if (queryParameterValue.system) {
                    quantityString += '|' + queryParameterValue.system;
                }
                if (queryParameterValue.code) {
                    quantityString += '|' + queryParameterValue.code;
                }
                if (useNotEquals) {
                    notQueryParameterValue = quantityString;
                    queryParameterValue = [];
                } else {
                    orQueryParameterValue = quantityString;
                }
                break;
            case 'date':
            case 'dateTime':
            case 'number':
                if (queryParameterValue.value) {
                    // noinspection JSValidateTypes
                    queryParameterValue.values = [queryParameterValue.value];
                }
                if (queryParameterValue.values) {
                    for (const dateValue of queryParameterValue.values) {
                        queryParameterValue = [];
                        const currentValues = [];
                        if (dateValue.equals) {
                            currentValues.push('eq' + dateValue.equals);
                        }
                        if (dateValue.notEquals) {
                            currentValues.push('ne' + dateValue.notEquals);
                        }
                        if (dateValue.greaterThan) {
                            currentValues.push('gt' + dateValue.greaterThan);
                        }
                        if (dateValue.greaterThanOrEqualTo) {
                            currentValues.push('ge' + dateValue.greaterThanOrEqualTo);
                        }
                        if (dateValue.lessThan) {
                            currentValues.push('lt' + dateValue.lessThan);
                        }
                        if (dateValue.lessThanOrEqualTo) {
                            currentValues.push('le' + dateValue.lessThanOrEqualTo);
                        }
                        if (dateValue.startsAfter) {
                            currentValues.push('sa' + dateValue.startsAfter);
                        }
                        if (dateValue.endsBefore) {
                            currentValues.push('eb' + dateValue.endsBefore);
                        }
                        if (dateValue.approximately) {
                            currentValues.push('ap' + dateValue.approximately);
                        }
                        if (currentValues.length === 1) {
                            orQueryParameterValue = orQueryParameterValue.concat(currentValues);
                        } else if (currentValues.length > 1) {
                            andQueryParameterValue.push(currentValues);
                        }
                    }
                }
                break;
            default:
                orQueryParameterValue = queryParameterValue;
                break;
        }
        if (queryParameterValue.missing) {
            args[`${queryParameter}:missing`] = queryParameterValue.missing;
        }
    } else {
        orQueryParameterValue = queryParameterValue;
    }
    return { orQueryParameterValue, andQueryParameterValue, notQueryParameterValue };
}

module.exports = {
    convertGraphQLParameters
};
