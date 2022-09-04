const {
    VERSIONS
} = require('./constants');

const schemasR4 = require('../../../fhir/classes/4_0_0/resources');
const schemasComplexTypeR4 = require('../../../fhir/classes/4_0_0/complex_types');

// const schemas3 = require('../resources/3_0_1/schemas');

// const schemas1 = require('../resources/1_0_2/schemas');
/**
 *
 * @param {String} version
 * @param {String} schema
 * @returns {function(Object): Resource}
 */
const resolveSchema = (version = '4_0_0', schema = '') => {
    const lowercaseSchema = schema.toLowerCase();

    switch (version) {
        // case '4_0_1':
        //     return schemasR401[lowercaseSchema];

        case '4_0_0':
            return schemasR4[`${lowercaseSchema}`] || schemasComplexTypeR4[`${lowercaseSchema}`];

        // case '3_0_1':
        //     return schemas3[lowercaseSchema];
        //
        // case '1_0_2':
        //     return schemas1[lowercaseSchema];
    }
};
/**
 * Utility helpful for checking if a given string is a valid FHIR version
 * within node-fhir-server-core
 * @param {String} version
 */


const isValidVersion = version => {
    return Object.keys(VERSIONS).includes(version);
};

module.exports = {
    resolveSchema,
    isValidVersion
};
