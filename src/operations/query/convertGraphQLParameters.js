/**
 * converts graphql parameters to standard FHIR parameters
 * @param {string | string[] | Object} queryParameterValue
 * @return {Object}
 */
function convertGraphQLParameters (queryParameterValue) {
    let notQueryParameterValue, orQueryParameterValue = null, andQueryParameterValue = [], modifiers = [];
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
                    if (queryParameterValue.value || queryParameterValue.values) {
                        orQueryParameterValue = queryParameterValue.value || queryParameterValue.values;
                    }
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
                    orQueryParameterValue = newQueryParameterValue;
                }
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
                if (referenceText && referenceText.length > 0) {
                    if (useNotEquals) {
                        notQueryParameterValue = referenceText;
                        queryParameterValue = [];
                    } else {
                        orQueryParameterValue = referenceText;
                    }
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
                if (quantityString && quantityString.length > 0) {
                    if (useNotEquals) {
                        notQueryParameterValue = quantityString;
                        queryParameterValue = [];
                    } else {
                        orQueryParameterValue = quantityString;
                    }
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
                    orQueryParameterValue = [];
                    for (const currentQueryParameterValue of queryParameterValue.values) {
                        const currentValues = [];
                        if (currentQueryParameterValue.equals) {
                            if (queryParameterValue.searchType === 'number') {
                                // 'eq' is not supported in number type
                                currentValues.push(currentQueryParameterValue.equals);
                            } else {
                                currentValues.push('eq' + currentQueryParameterValue.equals);
                            }
                        }
                        if (currentQueryParameterValue.notEquals) {
                            currentValues.push('ne' + currentQueryParameterValue.notEquals);
                        }
                        if (currentQueryParameterValue.greaterThan) {
                            currentValues.push('gt' + currentQueryParameterValue.greaterThan);
                        }
                        if (currentQueryParameterValue.greaterThanOrEqualTo) {
                            currentValues.push('ge' + currentQueryParameterValue.greaterThanOrEqualTo);
                        }
                        if (currentQueryParameterValue.lessThan) {
                            currentValues.push('lt' + currentQueryParameterValue.lessThan);
                        }
                        if (currentQueryParameterValue.lessThanOrEqualTo) {
                            currentValues.push('le' + currentQueryParameterValue.lessThanOrEqualTo);
                        }
                        if (currentQueryParameterValue.startsAfter) {
                            currentValues.push('sa' + currentQueryParameterValue.startsAfter);
                        }
                        if (currentQueryParameterValue.endsBefore) {
                            currentValues.push('eb' + currentQueryParameterValue.endsBefore);
                        }
                        if (currentQueryParameterValue.approximately) {
                            currentValues.push('ap' + currentQueryParameterValue.approximately);
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
        if (Object.hasOwn(queryParameterValue, 'missing') && orQueryParameterValue === null) {
            modifiers.push('missing');
            orQueryParameterValue = queryParameterValue.missing;
        }
    } else {
        orQueryParameterValue = queryParameterValue;
    }
    return { orQueryParameterValue, andQueryParameterValue, notQueryParameterValue, newModifiers: modifiers };
}

module.exports = {
    convertGraphQLParameters
};
