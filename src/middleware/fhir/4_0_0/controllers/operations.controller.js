const handler = require('../../fhir-response-util');
const {FhirOperationsManager} = require('../../../../operations/fhirOperationsManager');
const {PostRequestProcessor} = require('../../../../utils/postRequestProcessor');
const {assertTypeEquals} = require('../../../../utils/assertType');

class CustomOperationsController {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirOperationsManager} fhirOperationsManager
     */
    constructor({postRequestProcessor, fhirOperationsManager}) {
        assertTypeEquals(postRequestProcessor, PostRequestProcessor);
        /**
         * @type {PostRequestProcessor}
         */
        this.postRequestProcessor = postRequestProcessor;
        assertTypeEquals(fhirOperationsManager, FhirOperationsManager);
        /**
         * @type {FhirOperationsManager}
         */
        this.fhirOperationsManager = fhirOperationsManager;
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
                const results = await this.fhirOperationsManager[`${name}`](args, {
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
                    this.fhirOperationsManager[`${name}`](req.sanitized_args, {
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

