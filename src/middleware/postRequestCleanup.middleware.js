const httpContext = require('express-http-context');
const {REQUEST_ID_TYPE} = require('../constants');
const {logError} = require('../operations/common/logging');

/**
 * @description Middleware factory for flushing PostRequestProcessor/RequestSpecificCache after the
 * response is sent. Required, not optional: several operations (e.g. SearchBundleOperation) only
 * *queue* PHI-read audit entries against the current requestId -- nothing drains that queue
 * automatically. Every route that reads PHI (REST via generic.controller.js, GraphQL, GraphQL v2,
 * MCP) must flush it explicitly after the response is sent, or audit entries silently never get
 * written and PostRequestProcessor/RequestSpecificCache leak one entry per request.
 * @return {function} Express middleware
 */
module.exports = function createPostRequestCleanupMiddleware() {
    return function postRequestCleanup(req, res, next) {
        res.once('finish', async () => {
            /**
             * @type {SimpleContainer}
             */
            const container1 = req.container;
            if (container1) {
                /**
                 * @type {PostRequestProcessor}
                 */
                const postRequestProcessor = container1.postRequestProcessor;
                if (postRequestProcessor) {
                    const requestId = httpContext.get(REQUEST_ID_TYPE.SYSTEM_GENERATED_REQUEST_ID);
                    /**
                     * @type {RequestSpecificCache}
                     */
                    const requestSpecificCache = container1.requestSpecificCache;
                    try {
                        await postRequestProcessor.executeAsync({requestId});
                    } catch (e) {
                        logError('postRequestCleanup: executeAsync failed', {error: e, requestId});
                    } finally {
                        await requestSpecificCache.clearAsync({requestId});
                    }
                }
            }
        });
        next();
    };
};
