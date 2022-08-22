const handler = require('../../fhir-response-util');
const {FhirOperationsManager} = require('../../../../operations/fhirOperationsManager');
const assert = require('node:assert/strict');
const {PostRequestProcessor} = require('../../../../utils/postRequestProcessor');

class CustomOperationsController {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     */
    constructor(postRequestProcessor) {
        assert(postRequestProcessor);
        assert(postRequestProcessor instanceof PostRequestProcessor);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
    }

    /**
     * @description Controller for all POST operations
     * @param {name: string, resourceType: string}
     */
    operationsPost(
        {
            name,
            resourceType
        }) {
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
                const results = await new FhirOperationsManager()[`${name}`](args, {
                    req
                }, resourceType);
                handler.read(req, res, results);
            } catch (e) {
                next(e);
            } finally {
                await this.postRequestProcessor.executeAsync();
            }
        };
    }

    /**
     * @description Controller for all GET operations
     * @param {name: string, resourceType: string}
     */
    operationsGet(
        {
            name,
            resourceType
        }) {
        return async (
            /** @type {import('http').IncomingMessage}*/req,
            /** @type {import('http').ServerResponse}*/res,
            /** @type {function() : void}*/next) => {
            try {
                const results = await
                    new FhirOperationsManager()[`${name}`](req.sanitized_args, {
                        req
                    }, resourceType);
                handler.read(req, res, results);
            } catch (e) {
                next(e);
            } finally {
                await this.postRequestProcessor.executeAsync();
            }
        };
    }
}

module.exports = {
    CustomOperationsController
};

