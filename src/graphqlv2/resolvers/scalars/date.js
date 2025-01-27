const { GraphQLScalarType, Kind } = require('graphql');

// https://www.hl7.org/fhir/r4b/datatypes.html#dateTime
const DATE_REGEX =
    /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?$/;

// https://www.hl7.org/fhir/r4b/search.html#date
const dateScalar = new GraphQLScalarType({
    name: 'Date',
    description:
        'Custom scalar type for date search parameter. Format can be one of YYYY, YYYY-MM, YYYY-MM-DD, YYYY-MM-DDThh:mm:ss+zz:zz or YYYY-MM-DDThh:mm:ssZ',
    serialize(value) {
        return value;
    },
    parseValue(value) {
        if (typeof value !== 'string') {
            throw new Error('Date must be of type string');
        }
        if (!DATE_REGEX.test(value)) {
            throw new Error(
                'Date must match the format one of YYYY, YYYY-MM, YYYY-MM-DD, YYYY-MM-DDThh:mm:ss+zz:zz or YYYY-MM-DDThh:mm:ssZ'
            );
        }
        return value;
    },
    parseLiteral(ast) {
        if (ast.kind !== Kind.STRING) {
            throw new Error('Date must be of type string');
        }
        if (!DATE_REGEX.test(ast.value)) {
            throw new Error(
                'Date must match the format one of YYYY, YYYY-MM, YYYY-MM-DD or YYYY-MM-DDThh:mm:ss+zz:zz'
            );
        }
        return ast.value;
    }
});

module.exports = {
    Date: dateScalar
};
