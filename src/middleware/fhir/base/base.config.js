const controller = require('./base.controller.js');


const routes = [
    {
        type: 'put',
        path: '/:base_version/',
        corsOptions: {
            methods: ['PUT']
        },
        args: [],
        controller: controller.batch
    }, {
        type: 'post',
        path: '/:base_version/',
        corsOptions: {
            methods: ['POST']
        },
        args: [],
        controller: controller.batch
    }, {
        type: 'get',
        path: '/:base_version',
        corsOptions: {
            methods: ['GET']
        },
        args: [],
        controller: controller.batch
    },
    {
        type: 'get',
        path: '/:base_version/([$])question',
        corsOptions: {
            methods: ['GET']
        },
        args: [],
        controller: controller.question
    },
    {
        type: 'post',
        path: '/:base_version/([$])question',
        corsOptions: {
            methods: ['POST']
        },
        args: [],
        controller: controller.question
    }
];
/**
 * @name exports
 * @summary Base config
 */

module.exports = {
    routes
};
