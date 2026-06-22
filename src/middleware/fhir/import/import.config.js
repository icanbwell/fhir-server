const { routeArgs } = require('../route.config.js');
const { VERSIONS } = require('../utils/constants.js');

const routes = [
    {
        path: '/:base_version/$import',
        method: 'POST',
        corsOptions: {
            methods: ['POST']
        },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'import'
    }
];

module.exports = {
    routes
};
