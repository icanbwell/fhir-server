class ParametersBodyParser {
    /**
     * parses the FHIR Parameters resource body and returns the parameters as an object
     * @param {Object} body
     * @param {Object} args
     * @returns {Object}
     */
    parseParametersResource({body, args}) {
        const parameterArgs = {};
        if (body &&
            typeof body === 'object' &&
            body.resourceType === 'Parameters' &&
            body.parameter &&
            Array.isArray(body.parameter)
        ) {
            for (const parameter of body.parameter) {
                parameterArgs[parameter.name] = parameter.valueString;
            }
        }
        return Object.assign({}, args, parameterArgs);
    }

    /**
     * parses form-urlencoded body and returns the parameters as an object
     * @param {Object} body
     * @param {Object} args
     * @returns {Object}
     */
    parseFormUrlEncoded({body, args}) {
        const parameterArgs = {};
        if (body && typeof body === 'object') {
            for (const key of Object.keys(body)) {
                parameterArgs[`${key}`] = body[`${key}`];
            }
        }
        return Object.assign({}, args, parameterArgs);
    }
}

module.exports = {
    ParametersBodyParser
};
