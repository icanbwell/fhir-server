const {
    VERSIONS
} = require('./constants');

const schemasR4B = require('../../../fhir/classes/4_0_0/resources');
const schemasComplexTypeR4B = require('../../../fhir/classes/4_0_0/complex_types');
const schemasCustom = require('../../../fhir/classes/4_0_0/custom_resources');

/**
 *
 * @param {String} version
 * @param {String} schema
 * @returns {function(Object): Resource}
 */
const resolveSchema = (version = '4_0_0', schema = '') => {
    const lowercaseSchema = schema.toLowerCase();

    switch (version) {
        case '4_0_0':
            return (
                schemasR4B[`${lowercaseSchema}`] ||
                schemasComplexTypeR4B[`${lowercaseSchema}`] ||
                schemasCustom[`${lowercaseSchema}`]
            );
    }
};
/**
 * Utility helpful for checking if a given string is a valid FHIR version
 * @param {String} version
 */

const isValidVersion = version => {
    return Object.keys(VERSIONS).includes(version);
};

module.exports = {
    resolveSchema,
    isValidVersion
};
