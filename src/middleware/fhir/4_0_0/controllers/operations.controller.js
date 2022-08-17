const handler = require('../../fhir-response-util');
/**
 * @description Controller for all POST operations
 */


module.exports.operationsPost = function operationsPost(
    {
        profile,
        name,
        logger: deprecatedLogger
    }) {
    let {
        serviceModule: service
    } = profile;
    return async (
        /** @type {import('http').IncomingMessage}*/req,
        /** @type {import('http').ServerResponse}*/res,
        /** @type {function() : void}*/next) => {
        let {
            base_version,
            id
        } = req.sanitized_args;
        let resource_body = req.body;
        let args = {
            id,
            base_version,
            resource: resource_body
        };

        try {
            const results = await service[`${name}`](args, {
                req
            }, deprecatedLogger);
            handler.read(req, res, results);
        } catch (e) {
            next(e);
        } finally {
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = req.container.postRequestProcessor;
            await postRequestProcessor.executeAsync();
        }
    };
};
/**
 * @description Controller for all GET operations
 */


module.exports.operationsGet = function operationsGet(
    {
        profile,
        name,
        logger: deprecatedLogger
    }) {
    let {
        serviceModule: service
    } = profile;
    return async (
        /** @type {import('http').IncomingMessage}*/req,
        /** @type {import('http').ServerResponse}*/res,
        /** @type {function() : void}*/next) => {
        try {
            const results = await
                service[`${name}`](req.sanitized_args, {
                    req
                }, deprecatedLogger);
            handler.read(req, res, results);
        } catch (e) {
            next(e);
        } finally {
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = req.container.postRequestProcessor;
            await postRequestProcessor.executeAsync();
        }
    };
};
