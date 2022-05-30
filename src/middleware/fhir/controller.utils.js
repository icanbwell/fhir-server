/* eslint-disable security/detect-object-injection */
const controllersR401 = require('@asymmetrik/node-fhir-server-core/dist/server/resources/4_0_1/controllers');

// const controllersR4 = require('@asymmetrik/node-fhir-server-core/dist/server/resources/4_0_0/controllers');

const controllers3 = require('@asymmetrik/node-fhir-server-core/dist/server/resources/3_0_1/controllers');

const controllers1 = require('@asymmetrik/node-fhir-server-core/dist/server/resources/1_0_2/controllers');

const genericController = require('./4_0_0/controllers/generic_controller');
/**
 *
 * @param {string} version
 * @param {string} resourceName
 */


const getController = (version, resourceName) => {
    switch (version) {
        case '4_0_1':
            return controllersR401[resourceName];

        case '4_0_0':
            return genericController;

        case '3_0_1':
            return controllers3[resourceName];

        case '1_0_2':
            return controllers1[resourceName];

        default:
            return controllersR401[resourceName];
    }
};

module.exports = {
    getController
};
