/**
 * Implements the main function
 */
const {createHttpTerminator} = require('http-terminator');

const {app} = require('./app');
const {fhirServerConfig} = require('./config');
const {loggers} = require('@asymmetrik/node-fhir-server-core');
const {connect} = require('./utils/connect');
const env = require('var');
const logger = loggers.get('default');

const main = async function () {
    await connect();

    const server = app.listen(fhirServerConfig.server.port, () => {
            const image = env.DOCKER_IMAGE || '';
            logger.verbose(`Server is up and running! Image: ${image}`);
        }
    );

    // https://stackoverflow.com/questions/56606305/difference-between-keepalivetimeout-and-timeout
    // https://www.w3schools.com/nodejs/prop_server_timeout.asp
    // The number of milliseconds of inactivity before a socket is presumed to have timed out.
    // A value of 0 will disable the timeout behavior on incoming connections.
    server.setTimeout(60 * 60 * 1000, () => {
        console.log('Server timeout');
    }); // 60 minutes
    // The number of milliseconds of inactivity a server needs to wait for additional incoming data, after it has
    // finished writing the last response, before a socket will be destroyed. If the server receives new data
    // before the keep-alive timeout has fired, it will reset the regular inactivity timeout, i.e., server.timeout.
    // A value of 0 will disable the keep-alive timeout behavior on incoming connections. A value of 0 makes the
    // http server behave similarly to Node.js versions prior to 8.0.0, which did not have a keep-alive timeout.
    // Timeout in milliseconds. Default: 5000 (5 seconds).
    server.keepAliveTimeout = 0;

    const httpTerminator = createHttpTerminator({
        server,
        gracefulTerminationTimeout: 7000,
    });

    process.on('SIGTERM', async function onSigterm() {
        logger.info('Beginning shutdown of server');
        try {
            await httpTerminator.terminate();
            logger.info('Successfully shut down server');
            process.exit(0);
        } catch (error) {
            logger.error('Failed to shutdown server: ', error);
            process.exit(1);
        }
    });

    // https://snyk.io/wp-content/uploads/10-best-practices-to-containerize-Node.js-web-applications-with-Docker.pdf
    process.on('SIGINT', async function onSigterm() {
        logger.info('Beginning shutdown of server for SIGINT');
        try {
            await httpTerminator.terminate();
            logger.info('Successfully shut down server for SIGINT');
            process.exit(0);
        } catch (error) {
            logger.error('Failed to shutdown server for SIGINT: ', error);
            process.exit(1);
        }
    });
};

main().catch(reason => {
    console.error(reason);
});
