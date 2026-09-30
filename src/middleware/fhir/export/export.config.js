const { routeArgs } = require('../route.config.js');
const { VERSIONS, INTERACTIONS } = require('../utils/constants.js');

const routes = [
    {
        path: '/:base_version/$export/:id',
        method: 'GET',
        corsOptions: {
            methods: ['GET']
        },
        args: [routeArgs.BASE, routeArgs.ID],
        versions: [VERSIONS['4_0_0']],
        operation: 'exportById',
        interaction: INTERACTIONS.OPERATIONS_GET
    },
    {
        path: '/:base_version/$export',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'export',
        interaction: INTERACTIONS.OPERATIONS_POST
    },
    {
        path: '/:base_version/Patient/$export',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'export',
        interaction: INTERACTIONS.OPERATIONS_POST
    },
    {
        path: '/:base_version/Group/:id/$export',
        method: 'GET',
        corsOptions: {
            methods: ['GET']
        },
        args: [routeArgs.BASE, routeArgs.ID],
        versions: [VERSIONS['4_0_0']],
        operation: 'export',
        interaction: INTERACTIONS.OPERATIONS_GET
    }
];

/**
 * @name exports
 * @summary Export config
 */
module.exports = {
    routes
};
