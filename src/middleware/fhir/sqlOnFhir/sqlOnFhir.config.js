const { routeArgs } = require('../route.config.js');
const { VERSIONS } = require('../utils/constants.js');

const routes = [
    {
        path: '/:base_version/ViewDefinition/$run',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'run'
    }
];

/**
 * @name exports
 * @summary SQL-on-FHIR $run config
 */
module.exports = {
    routes
};
