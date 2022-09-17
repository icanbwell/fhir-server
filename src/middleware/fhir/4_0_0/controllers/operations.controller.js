const {FhirOperationsManager} = require('../../../../operations/fhirOperationsManager');
const {PostRequestProcessor} = require('../../../../utils/postRequestProcessor');
const {assertTypeEquals} = require('../../../../utils/assertType');
const {FhirResponseWriter} = require('../../fhirResponseWriter');

class CustomOperationsController {
    /**
     * constructor
     * @param {PostRequestProcessor} postRequestProcessor
     * @param {FhirOperationsManager} fhirOperationsManager
     * @param {FhirResponseWriter} fhirResponseWriter
     */
    constructor({
                    postRequestProcessor, fhirOperationsManager,
                    fhirResponseWriter
                }) {
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
        /**
         * @type {FhirResponseWriter}
         */
        this.fhirResponseWriter = fhirResponseWriter;
        assertTypeEquals(fhirResponseWriter, FhirResponseWriter);
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
                const result = await this.fhirOperationsManager[`${name}`](args, {
                    req
                }, resourceType);
                if (name === 'merge') {
                    this.fhirResponseWriter.merge({req, res, result});
                } else {
                    this.fhirResponseWriter.readCustomOperation({req, res, result});
                }
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
                const result = await
                    this.fhirOperationsManager[`${name}`](req.sanitized_args, {
                        req
                    }, resourceType);
                this.fhirResponseWriter.readCustomOperation({req, res, result});
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

