/**
 * Coverage settings shared by the integration and the unit jest configs, so both count the same
 * files and their reports can be merged into one by `jest/mergeCoverage.js`. Every hand-written
 * source file is counted, including files no test loads, which then show as 0%. Test code and the
 * files the generator scripts write are not counted; the hand-written serializers and GraphQL
 * resolvers in the folders next to the generated ones (`custom*`, `simple_types`, `scalars`) are.
 */
module.exports = {
    collectCoverageFrom: ['src/**/*.js'],
    coveragePathIgnorePatterns: [
        '<rootDir>/src/tests/',
        '<rootDir>/src/testutils/',
        '<rootDir>/src/fhir/generator',
        '<rootDir>/src/fhir/serializers/4_0_0/(resources|complex_types|backbone_elements)/',
        '<rootDir>/src/fhir/writeSerializers/4_0_0/(resources|complexTypes|backboneElements)/',
        '<rootDir>/src/mcp/tools/',
        '<rootDir>/src/mcp/typeValueSyntaxHints.js',
        '<rootDir>/src/searchParameters/searchParameters.js',
        '<rootDir>/src/profiles.js',
        '<rootDir>/src/middleware/fhir/resources',
        '<rootDir>/src/views',
        '<rootDir>/src/services',
        '<rootDir>/src/graphql/resolvers/(backbone_elements|complex_types|extensions|resources)/',
        '<rootDir>/src/graphqlv2/resolvers/(backbone_elements|complex_types|extensions|interfaces|resources)/',
        '<rootDir>/src/graphqlv2/resolvers/custom/patient.js'
    ]
};
