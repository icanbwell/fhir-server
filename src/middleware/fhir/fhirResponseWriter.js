const path = require('path');
const {assertTypeEquals} = require('../../utils/assertType');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const httpContext = require('express-http-context');
const {REQUEST_ID_TYPE} = require('../../constants');

/**
 * @classdesc Writes response in FHIR
 */
class FhirResponseWriter {
    constructor() {
        // ok to not specify
    }


    /**
     * @function getContentType
     * @description Get the correct application type for the response
     * @param {string} version Version of resources we are working with
     */
    getContentType(version) {
        switch (version) {
            case '1_0_2':
                return 'application/json+fhir';
            case '3_0_1':
            case '4_0_0':
                return 'application/fhir+json';
            default:
                return 'application/json';
        }
    }

    /**
     * @function read
     * @description Used when you are returning a Bundle of resources
     * @param {import('express').Request} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource} result - json to send to client
     */
    read({req, res, result}) {
        assertTypeEquals(result, Resource);
        this.setBaseResponseHeaders({req, res});
        res.status(200).json(result.toJSON());
    }

    /**
     * @function read
     * @description Used when you are returning a Bundle of resources
     * @param {import('express').Request} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource|Object} result - json to send to client
     */
    readCustomOperation({req, res, result}) {
        this.setBaseResponseHeaders({req, res});
        res.status(200).json(result instanceof Resource ? result.toJSON() : result);
    }

    /**
     * @function graph
     * @description Used when you are returning a Bundle of resources
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource|Object} result - json to send to client
     */
    graph({req, res}) {
        this.setBaseResponseHeaders({req, res});
    }

    /**
     * @function graph
     * @description Used when you are returning a Bundle of resources
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource|Object} result - json to send to client
     */
    everything({req, res, result}) {
        this.setBaseResponseHeaders({req, res});
        // don't write if we're streaming the response
        if (!res.headersSent) {
            res.status(200).json(result);
        }
    }

    /**
     * @function read
     * @description Used when you are returning a Bundle of resources
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {MergeResultEntry[]} result - json to send to client
     */
    merge({req, res, result}) {
        this.setBaseResponseHeaders({req, res});
        res.status(200).json(result);
    }

    /**
     * @function readOne
     * @description Used when you are returning a single resource of any type
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource} resource - resource to send to client
     */
    readOne({req, res, resource}) {
        let fhirVersion = req.params.base_version;

        if (resource && resource.meta) {
            res.set('Last-Modified', resource.meta.lastUpdated);
            res.set('ETag', `W/"${resource.meta.versionId}"`);
        }

        if (!res.headersSent) {
            res.type(this.getContentType(fhirVersion));
        }
        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
        if (resource) {
            res.status(200).json(resource);
        } else {
            res.sendStatus(404);
        }
    }

    /**
     * @function create
     * @description Used when you are creating a single resource of any type
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource} resource - json to send to client
     * @param {{type: string}} options - Any additional options necessary to generate response
     */
    create({req, res, resource, options}) {
        let fhirVersion = req.params.base_version ? req.params.base_version : '';
        let baseUrl = `${req.protocol}://${req.get('host')}`;

        // https://hl7.org/fhir/http.html#create
        let location;
        if (fhirVersion === '') {
            location = `${options.type}/${resource.id}`;
        } else {
            location = `${fhirVersion}/${options.type}/${resource.id}`;
        }

        if (resource.meta && resource.meta.versionId) {
            let pathname = path.posix.join(location, '_history', resource.meta.versionId);
            res.set('Content-Location', `${baseUrl}/${pathname}`);
            res.set('ETag', `W/"${resource.meta.versionId}"`);
        }
        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
        res.set('Location', location);
        // https://hl7.org/fhir/http.html#ops
        if (req.headers.prefer && req.headers.prefer === 'return=minimal') {
            res.status(201).json({}).end();
        } else {
            res.status(201).json(resource).end();
        }
        //TODO: handle return=OperationOutcome
    }

    /**
     * @function update
     * @description Used when you are updating a single resource of any type
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {{id: string, resource_version: string|undefined, created: boolean, resource: Resource}} result - json to send to client
     * @param {{type: string}} options - Any additional options necessary to generate response
     */
    update({req, res, result, options}) {
        let fhirVersion = req.params.base_version;
        let baseUrl = `${req.protocol}://${req.get('host')}`;
        let location = `${fhirVersion}/${options.type}/${result.id}`;
        let status = result.created ? 201 : 200;
        let date = new Date();

        if (result.resource_version) {
            let pathname = path.posix.join(location, '_history', result.resource_version);
            res.set('Content-Location', `${baseUrl}/${pathname}`);
            res.set('ETag', `W/"${result.resource_version}"`);
        }
        res.set('Last-Modified', date.toISOString());
        res.type(this.getContentType(fhirVersion));
        res.set('Location', location);
        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
        // https://hl7.org/fhir/http.html#ops
        if (req.headers.prefer && req.headers.prefer === 'return=minimal') {
            res.status(status).json({}).end();
        } else { // or return=representation
            res.status(status).json(result.resource.toJSON()).end();
        }
        // TODO: handle return=OperationOutcome
    }

    /**
     * @function remove
     * @description Used when you are deleting a single resource of any type
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Object} json - json to send to client
     */
    remove({req, res, json}) {
        if (json && json.deleted) {
            res.set('ETag', json.deleted);
        }
        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
        res.status(204).json({}).end();
    }

    /**
     * @function history
     * @description Used when you are querying the history of a resource of any type
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Object} json - json to send to client
     */
    history({req, res, json}) {
        let version = req.params.base_version;
        res.type(this.getContentType(version));
        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
        res.status(200).json(json);
    }

    /**
     * @function setBaseResponseHeaders
     * @description Used to set base response headers
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     */
    setBaseResponseHeaders({req, res}) {
        if (!res.headersSent) {
            let fhirVersion = req.params.base_version;
            res.type(this.getContentType(fhirVersion));
        }

        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
    }
}

module.exports = {
    FhirResponseWriter
};
