const {
    getLogger
} = require('../../../winstonInit');

const logger = getLogger();

const path = require('path');

const request = require('superagent');

const errors = require('../utils/error.utils');

const { fhirServerConfig } = require('../../../config');

const makeResultBundle = (results, res, baseVersion, type) => {
    const Bundle = require(`../../../fhir/classes/${baseVersion}/resources/bundle`);

    const BundleLink = require(`../../../fhir/classes/${baseVersion}/backbone_elements/bundleLink`);

    const BundleEntry = require(`../../../fhir/classes/${baseVersion}/backbone_elements/bundleEntry`);

    const selfLink = new BundleLink({
        url: `${res.req.protocol}://${path.join(res.req.get('host'), res.req.baseUrl)}`,
        relation: 'self'
    });
    const bundle = new Bundle({
        link: selfLink,
        type
    });
    const entries = [];
    results.forEach(result => {
        entries.push(new BundleEntry({
            response: result,
            request: result
        }));
    });
    bundle.entry = entries;
    bundle.total = entries.length;
    return bundle;
};

const ALLOWED_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
// Only allow relative FHIR resource paths: no protocol, no host, no .. traversal. The leading
// character class has no '/' or ':', which is what actually blocks a protocol-relative
// ("//host/evil") or absolute-URL bypass - everything after that is safe to allow more broadly
// (query-string characters included) because the destination host/scheme are always fixed before
// this value is appended (see serverHost below), so nothing in here can redirect the request.
const RELATIVE_PATH_RE = /^[A-Za-z0-9$_-][A-Za-z0-9$_./?=&|:,%+-]*$/;

const createRequestPromises = (entries, req, baseVersion) => {
    const {
        baseUrl
    } = req;
    // This is a same-process loopback call: the batch/transaction handler re-dispatches each
    // bundle entry back through this server's own single-resource endpoints. The destination
    // must never be derived from anything caller-controlled - not even req.hostname, which
    // resolves to an attacker-suppliable value here (this app enables "trust proxy"
    // unconditionally in src/app.js, so req.hostname/req.host prefer X-Forwarded-Host from any
    // client, not only from a verified upstream proxy). Always target our own configured
    // listening port on loopback instead, over plain HTTP (this app never terminates TLS itself).
    const serverHost = `127.0.0.1:${fhirServerConfig.server.port}`;
    const requestPromises = [];
    const results = [];

    entries.forEach(entry => {
        const {
            url,
            method
        } = entry.request;
        const resource = entry.resource;
        const normalizedMethod = (method || '').toLowerCase();
        if (!ALLOWED_METHODS.has(normalizedMethod)) {
            throw new Error(`Disallowed method in bundle entry: ${method}`);
        }
        if (!url || !RELATIVE_PATH_RE.test(url) || url.includes('..')) {
            throw new Error(`Disallowed or unsafe URL in bundle entry: ${url}`);
        }
        // Split off the query string before path.join(): it collapses '//' to '/', which would
        // corrupt a token-search value containing a system URI (e.g. '?identifier=http://x|123'
        // becomes '?identifier=http:/x|123' if the whole url is passed through path.join()).
        const queryIndex = url.indexOf('?');
        const urlPath = queryIndex === -1 ? url : url.slice(0, queryIndex);
        const urlQuery = queryIndex === -1 ? '' : url.slice(queryIndex);
        const destinationUrl = `http://${path.join(serverHost, baseUrl, baseVersion, urlPath)}${urlQuery}`;
        results.push({
            method,
            url: destinationUrl
        });
        requestPromises.push(Promise.resolve(
            request[normalizedMethod](destinationUrl).send(resource).set('Content-Type', 'application/json+fhir')
        ).catch(err => {
            return err;
        }));
    });
    return { requestPromises, results };
};

const processRequest = requestType => {
    return (req, res) => new Promise((resolve, reject) => {
        logger.info(`Base >>> ${requestType}`);
        const {
            resourceType,
            type,
            entry: entries
        } = req.body;
        const {
            base_version: baseVersion
        } = req.params;

        if (resourceType !== 'Bundle') {
            return reject(errors.internal(`Expected 'resourceType: Bundle'. Received 'resourceType: ${resourceType}'.`, baseVersion));
        }

        if (type.toLowerCase() !== requestType) {
            return reject(errors.internal(`Expected 'type: ${requestType}'. Received 'type: ${type}'.`, baseVersion));
        }

        const { requestPromises, results } = createRequestPromises(entries, req, baseVersion);
        return Promise.all(requestPromises).then(responses => {
            for (let i = 0; i < responses.length; i++) {
                results[`${i}`].status = responses[`${i}`].status;
            }

            const resultsBundle = makeResultBundle(results, res, baseVersion, requestType);
            resolve(resultsBundle);
        }).catch(reject);
    });
};

const processQuestion = () => {

    return (req, res) => new Promise((resolve, reject) => {
        logger.info('Base >>> Question');
        return resolve({});
    });
};

module.exports.batch = processRequest('batch');

module.exports.question = processQuestion();

module.exports.transaction = processRequest('transaction');
