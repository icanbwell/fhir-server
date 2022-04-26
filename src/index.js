/**
 * Implements the main function
 */
const {createHttpTerminator} = require('http-terminator');

const {app} = require('./app');
const {fhirServerConfig} = require('./config');
const {loggers} = require('@asymmetrik/node-fhir-server-core');
const {connect} = require('./utils/connect');
const logger = loggers.get('default');

const main = async function () {
    await connect();

    const server = app.listen(fhirServerConfig.server.port, () =>
        logger.verbose('Server is up and running!')
    );

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
