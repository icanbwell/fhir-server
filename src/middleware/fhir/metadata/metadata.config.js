const controller = require('./metadata.controller.js');

const {
    routeArgs
} = require('../route.config.js');

const route = {
    path: '/:base_version/metadata',
    corsOptions: {
        methods: ['GET']
    },
    args: [routeArgs.BASE],
    controller: controller.getCapabilityStatement
};
/**
 * @name exports
 * @summary Metadata config
 */

module.exports = {
    route
};
