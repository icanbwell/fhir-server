const {
    getLogger
} = require('../../../winstonInit');

let logger = getLogger();

const path = require('path');

const request = require('superagent');

const errors = require('../utils/error.utils');

const makeResultBundle = (results, res, baseVersion, type) => {
    let Bundle = require(`../resources/${baseVersion}/schemas/bundle`);

    let BundleLink = require(`../resources/${baseVersion}/schemas/bundlelink`);

    let BundleEntry = require(`../resources/${baseVersion}/schemas/bundleentry`);

    let selfLink = new BundleLink({
        url: `${res.req.protocol}://${path.join(res.req.get('host'), res.req.baseUrl)}`,
        relation: 'self'
    });
    let bundle = new Bundle({
        link: selfLink,
        type: type
    });
    let entries = [];
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

const createRequestPromises = (entries, req, baseVersion) => {
    let {
        protocol,
        baseUrl
    } = req;
    let requestPromises = [];
    let results = [];

    entries.forEach(entry => {
        let {
            url,
            method
        } = entry.request;
        let resource = entry.resource;
        let destinationUrl = `${protocol}://${path.join(req.headers.host, baseUrl, baseVersion, url)}`;
        results.push({
            method: method,
            url: destinationUrl
        });
        requestPromises.push(Promise.resolve(
            request[method.toLowerCase()](destinationUrl).send(resource).set('Content-Type', 'application/json+fhir')
        ).catch(err => {
            return err;
        }));
    });
    return {requestPromises, results};
};

const processRequest = requestType => {
    return (req, res) => new Promise((resolve, reject) => {
        logger.info(`Base >>> ${requestType}`);
        let {
            resourceType,
            type,
            entry: entries,
        } = req.body;
        let {
            base_version: baseVersion,
        } = req.params;

        if (resourceType !== 'Bundle') {
            return reject(errors.internal(`Expected 'resourceType: Bundle'. Received 'resourceType: ${resourceType}'.`, baseVersion));
        }

        if (type.toLowerCase() !== requestType) {
            return reject(errors.internal(`Expected 'type: ${requestType}'. Received 'type: ${type}'.`, baseVersion));
        }

        const {requestPromises, results} = createRequestPromises(entries, req, baseVersion);
        return Promise.all(requestPromises).then(responses => {
            for (let i = 0; i < responses.length; i++) {
                results[`${i}`].status = responses[`${i}`].status;
            }


            let resultsBundle = makeResultBundle(results, res, baseVersion, requestType);
            resolve(resultsBundle);
        });
    });
};

const processQuestion = () => {
// eslint-disable-next-line no-unused-vars
    return (req, res) => new Promise((resolve, reject) => {
        logger.info('Base >>> Question');
        let {
// eslint-disable-next-line no-unused-vars
            resourceType,
// eslint-disable-next-line no-unused-vars
            type,
        } = req.body;
        let {
// eslint-disable-next-line no-unused-vars
            base_version: baseVersion,
        } = req.params;

        return resolve({});
    });
};

module.exports.batch = processRequest('batch');

module.exports.question = processQuestion();

module.exports.transaction = processRequest('transaction');
