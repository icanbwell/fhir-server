/**
 * Implements the main function
 */
const {createHttpTerminator} = require('http-terminator');

const {app, fhirApp} = require('./app');
const asyncHandler = require('./lib/async-handler');
const mongoClient = require('./lib/mongo');
const globals = require('./globals');
const {fhirServerConfig, mongoConfig, atlasMongoConfig} = require('./config');
const {CLIENT, CLIENT_DB, ATLAS_CLIENT, ATLAS_CLIENT_DB} = require('./constants');
const env = require('var');

const main = async function () {
    // Connect to mongo and pass any options here
    let [mongoErr, client] = await asyncHandler(
        mongoClient(mongoConfig.connection, mongoConfig.options)
    );

    if (mongoErr) {
        console.error(mongoErr.message);
        console.error(mongoConfig.connection);
        process.exit(1);
    }
    client.db('admin').command({ping: 1});

    globals.set(CLIENT, client);
    globals.set(CLIENT_DB, client.db(mongoConfig.db_name));

    if (env.ATLAS_MONGO_URL) {
        let [atlasMongoErr, atlasClient] = await asyncHandler(
            mongoClient(atlasMongoConfig.connection, atlasMongoConfig.options)
        );

        if (atlasMongoErr) {
            console.error(atlasMongoErr.message);
            console.error(atlasMongoConfig.connection);
            process.exit(1);
        }
        atlasClient.db('admin').command({ping: 1});
        globals.set(ATLAS_CLIENT, atlasClient);
        globals.set(ATLAS_CLIENT_DB, atlasClient.db(atlasMongoConfig.db_name));
    }


    const server = app.listen(fhirServerConfig.server.port, () =>
        fhirApp.logger.verbose('Server is up and running!')
    );

    const httpTerminator = createHttpTerminator({
        server,
        gracefulTerminationTimeout: 7000,
    });

    process.on('SIGTERM', async function onSigterm() {
        fhirApp.logger.info('Beginning shutdown of server');
        try {
            await httpTerminator.terminate();
            fhirApp.logger.info('Successfully shut down server');
            process.exit(0);
        } catch (error) {
            fhirApp.logger.error('Failed to shutdown server: ', error);
            process.exit(1);
        }
    });

    // https://snyk.io/wp-content/uploads/10-best-practices-to-containerize-Node.js-web-applications-with-Docker.pdf
    process.on('SIGINT', async function onSigterm() {
        fhirApp.logger.info('Beginning shutdown of server for SIGINT');
        try {
            await httpTerminator.terminate();
            fhirApp.logger.info('Successfully shut down server for SIGINT');
            process.exit(0);
        } catch (error) {
            fhirApp.logger.error('Failed to shutdown server for SIGINT: ', error);
            process.exit(1);
        }
    });
};

main().catch(reason => {
    console.error(reason);
});
