const http = require('http');
const { createTerminus } = require('@godaddy/terminus');
const { createApp } = require('./app');
const { fhirServerConfig } = require('./config');
const { logError, logInfo } = require('./operations/common/logging');
const { logSystemEventAsync } = require('./operations/common/systemEventLogging');
const { getImageVersion } = require('./utils/getImageVersion');
const { handleReadinessCheck } = require('./routeHandlers/probeChecker');
/**
 * To use uncaught error handlers, we need to import the file
 */
require('./middleware/errorHandler');

/**
 * @param {() => import('../utils/simpleContainer').SimpleContainer} fnGetContainer
 * @returns {Promise<void>}
 */
const flushBuffer = async (fnGetContainer) => {
    logInfo('Flushing buffer before exiting the process');
    /**
     * @type {import('../utils/simpleContainer').SimpleContainer}
     */
    const container = fnGetContainer();

    /**
     * @type {import('./utils/postRequestProcessor').PostRequestProcessor}
     */
    const postRequestProcessor = container.postRequestProcessor;
    await postRequestProcessor.waitTillAllRequestsDoneAsync({timeoutInSeconds: null});
    /**
     * @type {import('./dataLayer/postSaveProcessor').PostSaveProcessor}
     */
    const postSaveProcessor = container.postSaveProcessor;
    await postSaveProcessor.flushAsync();
    /**
     * @type {import('./utils/auditLogger').AuditLogger}
     */
    const auditLogger = container.auditLogger;
    await auditLogger.flushAsync();
    /**
     * @type {import('./utils/accessLogger').AccessLogger}
     */
    const accessLogger = container.accessLogger;
    await accessLogger.flushAsync();
};

/**
 * Creates the http server
 * @param {function (): SimpleContainer} fnGetContainer
 * @return {Promise<import('http').Server>}
 */
async function createServer (fnGetContainer) {
    const container = fnGetContainer();
    await container.mongoDatabaseManager.connectAsync();

    const app = createApp({ fnGetContainer });

    const server = http
        .createServer(app)
        .listen(fhirServerConfig.server.port, null, null, async () => {
            const image = process.env.DOCKER_IMAGE || '';
            await logSystemEventAsync({
                event: 'serverStartup',
                message: 'Server is up and running',
                args: { image, version: getImageVersion() }
            });
        });

    // https://stackoverflow.com/questions/56606305/difference-between-keepalivetimeout-and-timeout
    // The number of milliseconds of inactivity a server needs to wait for additional incoming data, after it has
    // finished writing the last response, before a socket will be destroyed. If the server receives new data
    // before the keep-alive timeout has fired, it will reset the regular inactivity timeout, i.e., server.timeout.
    // A value of 0 will disable the keep-alive timeout behavior on incoming connections. A value of 0 makes the
    // http server behave similarly to Node.js versions prior to 8.0.0, which did not have a keep-alive timeout.
    // Timeout in milliseconds. Default: 5000 (5 seconds).
    server.keepAliveTimeout = process.env.KEEP_ALIVE_TIMEOUT ? parseInt(process.env.KEEP_ALIVE_TIMEOUT) : 10 * 60 * 1000;

    server.on('connection', function (socket) {
        // https://nodejs.org/api/net.html#net_socket_settimeout_timeout_callback
        // The number of milliseconds of inactivity before a socket is presumed to have timed out.
        // A value of 0 will disable the timeout behavior on incoming connections.
        socket.setTimeout(process.env.SOCKET_TIMEOUT ? parseInt(process.env.SOCKET_TIMEOUT) : 10 * 60 * 1000);
        socket.once('timeout', function () {
            logInfo('Socket timeout', {});
            socket.end();
        });
        socket.once('error', function (e) {
            logError('Socket error', { error: e, errMessage: e.message, stack: e.stack });
            socket.end();
        });
    });

    const options = {
        healthChecks: {
            '/ready': handleReadinessCheck
        },
        statusOkResponse: 'OK',
        statusError: 455,
        statusErrorResponse: 455,
        timeout: process.env.GRACEFUL_TIMEOUT_MS ? parseInt(process.env.GRACEFUL_TIMEOUT_MS) : 29000, // number of milliseconds before forceful exiting
        signals: ['SIGTERM', 'SIGINT', 'SIGQUIT'], // array of signals to listen for relative to shutdown
        beforeShutdown: async () => {
            // https://github.com/godaddy/terminus?tab=readme-ov-file#how-to-set-terminus-up-with-kubernetes
            let serverShutdownDelay = process.env.SHUTDOWN_DELAY_MS
                ? parseInt(process.env.SHUTDOWN_DELAY_MS)
                : 15100; // number of milliseconds before shutdown begin
            logInfo(`Server will begin shutdown in ${serverShutdownDelay / 1000} sec`, {});
            return new Promise((resolve) => {
                setTimeout(() => {
                    logInfo('Beginning shutdown of server', {});
                    // server stops accepting new requests after this point
                    resolve();
                }, serverShutdownDelay);
            });
        }, // called before the HTTP server starts its shutdown
        onSignal: async () => {
            // for flushing dd-trace and sentry
            logInfo('Emitting beforeExit event');
            process.emit('beforeExit');
            await flushBuffer(fnGetContainer);
            logInfo('Disconnecting Kafka producer');
            await container.kafkaClient.disconnect();
        },
        onShutdown: () => {
            logInfo('Successfully shut down server', {});
        }, // called right before exiting
        useExit0: true, // instead of sending the received signal again without being catched, the process will exit(0)
        logError // logger function to be called with errors. Example logger call: ('error happened during shutdown', error). See terminus.js for more details.
    };

    createTerminus(server, options);

    return server;
}

module.exports = {
    createServer
};
