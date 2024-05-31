const { routeArgs } = require('../route.config.js');
const { VERSIONS } = require('../utils/constants.js');

const routes = [
    {
        path: '/:base_version/([$])export',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']]
    },
    {
        path: '/:base_version/Patient/([$])export',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']]
    }
];

/**
 * @name exports
 * @summary Export config
 */
module.exports = {
    routes
};
