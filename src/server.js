const {createApp} = require('./app');
const {fhirServerConfig} = require('./config');
const env = require('var');
const {logError, logInfo} = require('./operations/common/logging');
const {logSystemEventAsync} = require('./operations/common/systemEventLogging');
const http = require('http');
const { isTrue } = require('./utils/isTrue');
const {getImageVersion} = require('./utils/getImageVersion');
const {MongoDatabaseManager} = require('./utils/mongoDatabaseManager');
const { createTerminus } = require('@godaddy/terminus');

/**
 * Creates the http server
 * @param {function (): SimpleContainer} fnGetContainer
 * @return {Promise<import('http').Server>}
 */
async function createServer(fnGetContainer, tracer) {
    await new MongoDatabaseManager().connectAsync();

    const app = createApp({fnGetContainer, trackMetrics: isTrue(env.TRACK_METRICS), tracer});

    const server = http
        .createServer(app)
        .listen(fhirServerConfig.server.port, null, null, async () => {
            const image = env.DOCKER_IMAGE || '';
            await logSystemEventAsync({
                event: 'serverStartup',
                message: 'Server is up and running',
                args: {image: image, version: getImageVersion()},
            });
        });

    // https://stackoverflow.com/questions/56606305/difference-between-keepalivetimeout-and-timeout
    // https://www.w3schools.com/nodejs/prop_server_timeout.asp
    // The number of milliseconds of inactivity before a socket is presumed to have timed out.
    // A value of 0 will disable the timeout behavior on incoming connections.
    server.setTimeout(10 * 60 * 1000, (/*socket*/) => {
        logInfo('Server timeout', {});
    }); // 60 minutes
    // The number of milliseconds of inactivity a server needs to wait for additional incoming data, after it has
    // finished writing the last response, before a socket will be destroyed. If the server receives new data
    // before the keep-alive timeout has fired, it will reset the regular inactivity timeout, i.e., server.timeout.
    // A value of 0 will disable the keep-alive timeout behavior on incoming connections. A value of 0 makes the
    // http server behave similarly to Node.js versions prior to 8.0.0, which did not have a keep-alive timeout.
    // Timeout in milliseconds. Default: 5000 (5 seconds).
    server.keepAliveTimeout = 10 * 60 * 1000;

    server.on('connection', function (socket) {
        socket.setTimeout(10 * 60 * 1000);
        socket.once('timeout', function () {
            logInfo('Socket timeout', {});
        });
        socket.once('error', function (e) {
            logError('Socket error', {error: e});
        });
    });

    const options = {
        timeout: env.GRACEFUL_TIMEOUT_MS ? parseInt(env.GRACEFUL_TIMEOUT_MS) : 29000, // number of milliseconds before forceful exiting
        signals: ['SIGTERM', 'SIGINT', 'SIGQUIT'], // array of signals to listen for relative to shutdown
        beforeShutdown: async () => {
            logInfo('Beginning shutdown of server', {});
            await logSystemEventAsync({
                event: 'shutdown',
                message: 'Beginning shutdown of server',
                args: {},
            });
        }, // called before the HTTP server starts its shutdown
        onShutdown: () => {
            logInfo('Successfully shut down server', {});
        }, // called right before exiting
        useExit0: true, // instead of sending the received signal again without being catched, the process will exit(0)
        logError, // logger function to be called with errors. Example logger call: ('error happened during shutdown', error). See terminus.js for more details.
    };

    createTerminus(server, options);

    return server;
}

module.exports = {
    createServer,
};
