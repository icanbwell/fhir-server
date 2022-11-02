/**
 * @description TAKEN FROM: https://stackabuse.com/nodejs-application-monitoring-with-prometheus-and-grafana/
 * The other prometheus libraries for express returned errors on Buffers.
 */
const client = require('prom-client');
const Register = require('prom-client').register;
const Counter = require('prom-client').Counter;
const Histogram = require('prom-client').Histogram;
const Summary = require('prom-client').Summary;
const responseTime = require('response-time');
/**
 * A Prometheus counter that counts the invocations of the different HTTP verbs
 * e.g. a GET and a POST call will be counted as 2 different calls
 */
const numOfRequests = new Counter({
    name: 'numOfRequests',
    help: 'Number of requests made',
    labelNames: ['method'],
});

module.exports.numOfRequests = numOfRequests;

/**
 * A Prometheus counter that counts the invocations with different paths
 * e.g. /foo and /bar will be counted as 2 different paths
 */
const pathsTaken = new Counter({
    name: 'pathsTaken',
    help: 'Paths taken in the app',
    labelNames: ['path'],
});

module.exports.pathsTaken = pathsTaken;

/**
 * A Prometheus counter that counts the invocations with different paths
 * e.g. /foo and /bar will be counted as 2 different paths
 */
const validationsFailedCounter = new Counter({
    name: 'validationsFailed',
    help: 'validationsFailed',
    labelNames: ['action', 'resourceType']
});

module.exports.validationsFailedCounter = validationsFailedCounter;

/**
 * A Prometheus counter that counts the invocations with different paths
 * e.g. /foo and /bar will be counted as 2 different paths
 */
const authorizationFailedCounter = new Counter({
    name: 'authorizationFailed',
    help: 'authorizationFailed',
    labelNames: ['action', 'resourceType']
});

module.exports.authorizationFailedCounter = authorizationFailedCounter;

/**
 * A Prometheus summary to record the HTTP method, path, response code and response time
 */
const responses = new Summary({
    name: 'responses',
    help: 'Response time in millis',
    labelNames: ['method', 'path', 'status'],
});

module.exports.responses = responses;

// Create a custom histogram metric
const fhirRequestTimer = new Histogram({
    name: 'fhir_request_duration_seconds',
    help: 'Duration of FHIR requests in seconds',
    labelNames: ['action', 'resourceType'],
    buckets: [0.01, 5, 25, 50, 75, 100, 125] // histogram buckets in seconds
});

module.exports.fhirRequestTimer = fhirRequestTimer;

// Create a custom histogram metric
const databaseBulkLoaderTimer = new Histogram({
    name: 'databaseBulkLoaderTimer',
    help: 'Duration of bulk loader in seconds',
    labelNames: ['resourceType'],
    buckets: [0.01, 5, 25, 50, 75, 100, 125] // histogram buckets in seconds
});

module.exports.databaseBulkLoaderTimer = databaseBulkLoaderTimer;

const databaseBulkInserterTimer = new Histogram({
    name: 'databaseBulkInserterTimer',
    help: 'Duration of bulk inserter in seconds',
    labelNames: ['resourceType'],
    buckets: [0.01, 5, 25, 50, 75, 100, 125] // histogram buckets in seconds
});

module.exports.databaseBulkInserterTimer = databaseBulkInserterTimer;

// https://github.com/prometheus/client_python
const partitionedCollectionsCount = new Histogram({
    name: 'partitionedCollectionsCount',
    help: 'Count of collections in DatabasePartitionedCursor',
    labelNames: ['resourceType'],
    buckets: [1, 2, 5, 10]
});

module.exports.partitionedCollectionsCount = partitionedCollectionsCount;


// Create a histogram metric
const httpRequestDurationMicroseconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'code'],
    buckets: [0.01, 5, 25, 50, 75, 100, 125] // histogram buckets in seconds
});

module.exports.httpRequestDurationMicroseconds = httpRequestDurationMicroseconds;

/**
 * This function will start the collection of metrics and should be called from within in the main js file
 */
module.exports.startCollection = function () {
    if (process.env.NODE_ENV !== 'test') {
        client.collectDefaultMetrics();
    }
};

/**
 * This function increments the counters that are executed on the request side of an invocation
 * Currently it increments the counters for numOfPaths and pathsTaken
 */
module.exports.requestCounters = function (req, res, next) {
    if (req.path !== '/metrics') {
        numOfRequests.inc({method: req.method});
        pathsTaken.inc({path: req.path});
    }
    next();
};

/**
 * This function increments the counters that are executed on the response side of an invocation
 * Currently it updates the responses summary
 */
const responseCounters = responseTime(function (req, res, time) {
    if (req.url !== '/metrics') {
        responses.labels(req.method, req.path, res.statusCode).observe(time);
        // console.info('res.StatusCode=' + res.statusCode);
        if (res.statusCode === 404) {
            validationsFailedCounter.inc(1);
        }
    }
});

module.exports.responseCounters = responseCounters;

const httpRequestTimer = responseTime(function (
    /** @type {import('http').IncomingMessage} */req,
    /** @type {import('http').ServerResponse} */ res,
    time) {
    if (req.url !== '/metrics') {
        httpRequestDurationMicroseconds.labels(req.method, req.path, res.statusCode).observe(time);
    }
});

module.exports.httpRequestTimer = httpRequestTimer;

/**
 * In order to have Prometheus get the data from this app a specific URL is registered
 */
module.exports.injectMetricsRoute = function (app) {
    app.get('/metrics', async (req, res) => {
        res.set('Content-Type', Register.contentType);
        res.end(await Register.metrics());
    });
};

