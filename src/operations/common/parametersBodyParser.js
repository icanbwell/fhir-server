class ParametersBodyParser {
    parseIntoParameters({body, args}) {
        const parameterArgs = {};
        if (body.resourceType === 'Parameters' && body.parameter && Array.isArray(body.parameter)) {
            for (const parameter of body.parameter) {
                parameterArgs[parameter.name] = parameter.valueString;
            }
        }
        return Object.assign({}, args, parameterArgs);
    }
}

module.exports = {
    ParametersBodyParser
};
