const { GraphQLScalarType, Kind } = require('graphql');

// https://www.hl7.org/fhir/r4b/datatypes.html#decimal
DECIMAL_REGEX = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

const decimalScalar = new GraphQLScalarType({
    name: 'Decimal',
    description: 'Decimal custom scalar type',
    serialize(value) {
        return value;
    },
    parseValue(value) {
        if (typeof value !== 'string') {
            throw new Error('Decimal must be of type string');
        }
        if (!DECIMAL_REGEX.test(value)) {
            throw new Error('Invalid Decimal');
        }
        return value;
    },
    parseLiteral(ast) {
        if (ast.kind !== Kind.STRING) {
            throw new Error('Decimal must be of type string');
        }
        if (!DECIMAL_REGEX.test(ast.value)) {
            throw new Error('Invalid Decimal');
        }
        return ast.value;
    }
});

module.exports = {
    Decimal: decimalScalar
};
