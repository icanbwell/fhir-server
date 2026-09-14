const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const httpContext = require('express-http-context');
const { REQUEST_ID_TYPE } = require('../../constants');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const { FhirResponseUrlBuilder } = require('../../utils/url/fhirResponseUrlBuilder');
const { FhirBasePath } = require('../../utils/url/fhirBasePath');

/**
 * @classdesc Writes response in FHIR
 */
class FhirResponseWriter {
    /**
     * @function getContentType
     * @description Get the correct application type for the response
     * @param {string} version Version of resources we are working with
     */
    getContentType (version) {
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
    read ({ req, res, result }) {
        this.setBaseResponseHeaders({ req, res });
        FhirResourceSerializer.serialize(result);
        res.status(200).json(result);
    }

    /**
     * @function read
     * @description Used when you are returning a Bundle of resources
     * @param {import('express').Request} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource|Object} result - json to send to client
     */
    readCustomOperation ({ req, res, result }) {
        this.setBaseResponseHeaders({ req, res });
        if (!res.headersSent) {
            res.status(200).json(result instanceof Resource ? result.toJSON() : result);
        }
    }

    /**
     * @function summary
     * @description Used when you are returning a Bundle of resources
     * @param {import('express').Request} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource|Object} result - json to send to client
     */
    summary({req, res, result}) {
        this.setBaseResponseHeaders({req, res});
    }

    /**
     * @function graph
     * @description Used when you are returning a Bundle of resources
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource|Object} result - json to send to client
     */
    graph ({ req, res }) {
        this.setBaseResponseHeaders({ req, res });
    }

    /**
     * @function graph
     * @description Used when you are returning a Bundle of resources
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource|Object} result - json to send to client
     */
    everything ({ req, res, result }) {
        this.setBaseResponseHeaders({ req, res });
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
    merge ({ req, res, result }) {
        this.setBaseResponseHeaders({ req, res });
        res.status(200).json(result);
    }

    /**
     * This methods to support merge streaming
     * @param req
     * @param res
     * @param stream
     */
    mergeStream({ req, res, stream }) {
        this.setBaseResponseHeaders({ req, res });
        res.status(200);
        stream.pipe(res);
    }

    /**
     * @function readOne
     * @description Used when you are returning a single resource of any type
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource} resource - resource to send to client
     */
    readOne ({ req, res, resource }) {
        // defence-in-depth only: post-rewrite (normalizeFhirBasePath) base_version is always the
        // canonical '4_0_0'; this reads req.fhirBasePath rather than req.params.base_version so an
        // unknown value can never silently fall through to application/json.
        const fhirVersion = (req.fhirBasePath || FhirBasePath.canonical()).canonicalVersion;

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
    create ({ req, res, resource, options }) {
        const responseUrls = FhirResponseUrlBuilder.fromRequest(req);

        // https://hl7.org/fhir/http.html#create
        const location = responseUrls.build(`${options.type}/${resource.id}`, { form: 'relative' });

        if (resource.meta && resource.meta.versionId) {
            const historyRelativePath = `${options.type}/${resource.id}/_history/${resource.meta.versionId}`;
            res.set('Content-Location', responseUrls.build(historyRelativePath, { form: 'absolute' }));
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
        // TODO: handle return=OperationOutcome
    }

    /**
     * @function update
     * @description Used when you are updating a single resource of any type
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {{id: string, resource_version: string|undefined, created: boolean, resource: Resource}} result - json to send to client
     * @param {{type: string}} options - Any additional options necessary to generate response
     */
    update ({ req, res, result, options }) {
        const responseUrls = FhirResponseUrlBuilder.fromRequest(req);
        const location = responseUrls.build(`${options.type}/${result.id}`, { form: 'relative' });
        const status = result.created ? 201 : 200;
        const date = new Date();

        if (result.resource_version) {
            const historyRelativePath = `${options.type}/${result.id}/_history/${result.resource_version}`;
            res.set('Content-Location', responseUrls.build(historyRelativePath, { form: 'absolute' }));
            res.set('ETag', `W/"${result.resource_version}"`);
        }
        res.set('Last-Modified', date.toISOString());
        res.type(this.getContentType(responseUrls.basePath.canonicalVersion));
        res.set('Location', location);
        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
        // https://hl7.org/fhir/http.html#ops
        if (req.headers.prefer && req.headers.prefer === 'return=minimal') {
            res.status(status).json({}).end();
        } else { // or return=representation
            res.status(status).json(result.resource).end();
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
    remove ({ req, res, json }) {
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
    history ({ req, res, json }) {
        // defence-in-depth only: see the comment in readOne() above.
        const version = (req.fhirBasePath || FhirBasePath.canonical()).canonicalVersion;
        res.type(this.getContentType(version));
        if (req.id && !res.headersSent) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
        res.status(200).json(json);
    }

    /**
     * @function export
     * @description Used when bulk export is triggered
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Object} result - results of the export
     */
    export ({ req, res, result }) {
        // req.protocol is trust-proxy aware (unlike the previous req.hostname.includes('localhost')
        // scheme sniff) - deliberate, see the trustProxy test family for coverage.
        const responseUrls = FhirResponseUrlBuilder.fromRequest(req);
        const statusUrl = responseUrls.build(`$export/${result?.id}`, { form: 'absolute' });

        res.setHeader('Content-Location', statusUrl);
        res.status(202).send();
    }

    /**
     * @function exportById
     * @description Used to check status of the bulk export
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Object} result - export status resource
     */
    exportById ({ req, res, result }) {
        if (result.status !== "completed") {
            res.setHeader('X-Progress', result.status);
            res.status(202).send();
        } else {
            const responseUrls = FhirResponseUrlBuilder.fromRequest(req);
            res.status(200).json({
                transactionTime: result.transactionTime,
                requiresAccessToken: result.requiresAccessToken,
                // re-projects the persisted canonical URL onto the polling request's spelling.
                request: responseUrls.build(result.request, { form: 'absolute' }),
                output: result.output,
                errors: result.errors
            });
        }
    }

    /**
     * @function import
     * @description Used when bulk import is triggered
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Object} result - results of the import
     */
    import ({ req, res, result }) {
        const responseUrls = FhirResponseUrlBuilder.fromRequest(req);
        res.setHeader('Content-Location', responseUrls.build(`Task/${result.id}`, { form: 'path' }));
        this.setBaseResponseHeaders({ req, res });
        res.status(202).json(result);
    }

    /**
     * @function setBaseResponseHeaders
     * @description Used to set base response headers
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     */
    setBaseResponseHeaders ({ req, res }) {
        if (res.headersSent) {
            return;
        }
        // defence-in-depth only: see the comment in readOne() above.
        const fhirVersion = (req.fhirBasePath || FhirBasePath.canonical()).canonicalVersion;
        if (!res.get("Content-Type")) {
            const contentType = this.getContentType(fhirVersion);
            res.type(contentType);
        }
        if (req.id) {
            res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
        }
    }
}

module.exports = {
    FhirResponseWriter
};
