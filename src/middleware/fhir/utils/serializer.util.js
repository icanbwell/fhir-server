const {
    VERSIONS
} = require('./constants');

const serializerR4B = require('../../../fhir/serializers/4_0_0/resources');
const serializerComplexTypeR4B = require('../../../fhir/serializers/4_0_0/complex_types');
const serializersCustom = require('../../../fhir/serializers/4_0_0/custom_resources');

/**
 *
 * @param {String} version
 * @param {String} schema8
 * @returns {{ serialize: (obj) => obj}}
 */
const resolveSerialzier = (version = '4_0_0', schema = '') => {
    const lowercaseSchema = schema.toLowerCase();

    switch (version) {
        case '4_0_0':
            return (
                serializerR4B[`${lowercaseSchema}`] ||
                serializerComplexTypeR4B[`${lowercaseSchema}`] ||
                serializersCustom[`${lowercaseSchema}`]
            );
    }
};

module.exports = {
    resolveSerialzier
};
