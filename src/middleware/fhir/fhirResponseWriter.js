const path = require('path');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const httpContext = require('express-http-context');
const { REQUEST_ID_TYPE } = require('../../constants');
const { FhirResourceSerializer } = require('../../fhir/fhirResourceSerializer');
const { hasPlainTextContentType } = require('../../utils/contentTypes');
const { logWarn } = require('../../operations/common/logging');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');

/**
 * Resource types for which `_format=text/plain` derived-text delivery (Task 11) is supported.
 * @type {Set<string>}
 */
const PLAIN_TEXT_SUPPORTED_RESOURCE_TYPES = new Set(['DocumentReference', 'DiagnosticReport', 'Binary']);

/**
 * @classdesc Writes response in FHIR
 */
class FhirResponseWriter {
    /**
     * @param {Object} params
     * @param {import('../../utils/clinicalNoteTextRetriever').ClinicalNoteTextRetriever} params.clinicalNoteTextRetriever
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor ({ clinicalNoteTextRetriever, configManager }) {
        /**
         * @type {import('../../utils/clinicalNoteTextRetriever').ClinicalNoteTextRetriever}
         */
        this.clinicalNoteTextRetriever = clinicalNoteTextRetriever;
        /**
         * @type {import('../../utils/configManager').ConfigManager}
         */
        this.configManager = configManager;
    }

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
     * @description Used when you are returning a single resource of any type. When the request
     * asks for `_format=text/plain` and the resource is one of PLAIN_TEXT_SUPPORTED_RESOURCE_TYPES
     * (and the fhir-notes full-text-search feature is configured), returns the resource's
     * reassembled derived text as a plain-text body instead of the resource's normal FHIR JSON.
     * This is `async` (and must be `await`ed by callers) so that the response is guaranteed to be
     * fully written before this returns -- see generic.controller.js's searchById/searchByVersionId,
     * which run cleanup (postRequestProcessor/requestSpecificCache) in a `finally` block
     * immediately after calling this.
     * @param {import('http').IncomingMessage} req - Express request object
     * @param {import('express').Response} res - Express response object
     * @param {Resource} resource - resource to send to client
     * @returns {Promise<void>}
     */
    async readOne ({ req, res, resource }) {
        const fhirVersion = req.params.base_version;

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

        if (!resource) {
            res.sendStatus(404);
            return;
        }

        const format = req.sanitized_args && req.sanitized_args._format;
        if (hasPlainTextContentType(format) &&
            PLAIN_TEXT_SUPPORTED_RESOURCE_TYPES.has(resource.resourceType) &&
            this.configManager.fhirNotesFullTextSearchConfigured &&
            !req.params.version_id) {
            // The vector store only stores the latest indexed text per chunk_group_id, with no
            // version component. `GET .../_history/{version_id}?_format=text/plain` is a vread --
            // a caller authorized against (and asking for) a specific historical version must not
            // silently receive current-version text if the resource's content/access has changed
            // since. Fall through to the resource's normal versioned JSON instead.
            let text = '';
            try {
                text = (await this.resolveDerivedTextAsync({ resource })) || '';
            } catch (e) {
                logWarn(`Failed to resolve derived text for ${resource.resourceType}/${resource.id}`, { error: e });
                text = '';
            }
            res.status(200).type('text/plain');
            res.send(text);
            return;
        }

        res.status(200).json(resource);
    }

    /**
     * Reassembles the derived text for a DocumentReference/DiagnosticReport/Binary resource, via
     * Task 7's ClinicalNoteTextRetriever. Never mutates `resource`.
     *
     * A vector-store hit is a candidate, never authoritative on its own -- this extracts the
     * `sourceAssigningAuthority` tenant tag from the resource's own, already-authorized
     * `meta.security` (mirrors the exact extraction pattern in
     * `src/operations/searchById/searchById.js`'s multiple-resources-same-id handling) and
     * threads it through to the retriever, which uses it as a real discriminator in its Mongo
     * query -- not a later filter step -- so a same-resourceType, cross-tenant raw-id collision
     * can never cross-serve another tenant's derived text (see task-11-report.md's Finding 4/5).
     * If the resource has no sourceAssigningAuthority tag, this fails closed: no lookup is
     * attempted at all, rather than guessing or falling back to an unscoped query.
     * @param {Object} params
     * @param {Resource} params.resource
     * @returns {Promise<string>}
     */
    async resolveDerivedTextAsync ({ resource }) {
        const sourceAssigningAuthorities = (resource.meta && resource.meta.security)
            ? resource.meta.security
                .filter(tag => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                .map(tag => tag.code)
            : [];
        const sourceAssigningAuthority = sourceAssigningAuthorities[0];
        if (!sourceAssigningAuthority) {
            logWarn(`Refusing derived-text lookup for ${resource.resourceType}/${resource.id}: no sourceAssigningAuthority security tag to scope the lookup by`);
            return '';
        }

        if (resource.resourceType === 'Binary') {
            return (await this.clinicalNoteTextRetriever.getReassembledTextForBinaryAsync({
                binaryReference: `Binary/${resource.id}`,
                sourceAssigningAuthority
            })) || '';
        }
        const attachmentArray = resource.resourceType === 'DocumentReference'
            ? resource.content
            : resource.presentedForm;
        if (!Array.isArray(attachmentArray)) {
            return '';
        }
        const texts = [];
        for (let index = 0; index < attachmentArray.length; index++) {
            const text = await this.clinicalNoteTextRetriever.getReassembledTextAsync({
                chunkGroupId: `${resource.id}-${index}`,
                resourceType: resource.resourceType,
                sourceAssigningAuthority
            });
            if (text) {
                texts.push(text);
            }
        }
        return texts.join('\n\n');
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
        const fhirVersion = req.params.base_version ? req.params.base_version : '';
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        // https://hl7.org/fhir/http.html#create
        let location;
        if (fhirVersion === '') {
            location = `${options.type}/${resource.id}`;
        } else {
            location = `${fhirVersion}/${options.type}/${resource.id}`;
        }

        if (resource.meta && resource.meta.versionId) {
            const pathname = path.posix.join(location, '_history', resource.meta.versionId);
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
        const fhirVersion = req.params.base_version;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const location = `${fhirVersion}/${options.type}/${result.id}`;
        const status = result.created ? 201 : 200;
        const date = new Date();

        if (result.resource_version) {
            const pathname = path.posix.join(location, '_history', result.resource_version);
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
        const version = req.params.base_version;
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
        const baseUrl = `${req.hostname.includes('localhost') ? 'http://' : 'https://'}${req.headers?.host}`;
        const statusUrl =`${baseUrl}/4_0_0/$export/${result?.id}`;

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
            res.status(200).json({
                transactionTime: result.transactionTime,
                requiresAccessToken: result.requiresAccessToken,
                request: result.request,
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
        res.setHeader('Content-Location', `/4_0_0/Task/${result.id}`);
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
        const fhirVersion = req.params.base_version;
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
