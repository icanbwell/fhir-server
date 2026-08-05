const { routeArgs } = require('../route.config.js');
const { VERSIONS } = require('../utils/constants.js');

const routes = [
    {
        path: '/:base_version/$export/:id',
        method: 'GET',
        corsOptions: {
            methods: ['GET']
        },
        args: [routeArgs.BASE, routeArgs.ID],
        versions: [VERSIONS['4_0_0']],
        operation: 'exportById'
    },
    {
        path: '/:base_version/$export',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'export'
    },
    {
        path: '/:base_version/Patient/$export',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'export'
    }
];

/**
 * @name exports
 * @summary Export config
 */
module.exports = {
    routes
};
