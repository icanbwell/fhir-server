const { createContainer } = require('../../createContainer');
const { CommandLineParser } = require('./commandLineParser');
const { ConfigureAuditEventOnlineArchiveRunner } = require('../runners/configureAuditEventOnlineArchiveRunner.js');
const { AdminLogger } = require('../adminLogger');

/**
 * main function
 * @returns {Promise<void>}
 */
async function main () {
    /**
        @type {Object}
    */
    const parameters = CommandLineParser.parseCommandLine();
    const adminLogger = new AdminLogger();
    const collections = parameters.collections ? parameters.collections.split(',') : undefined;
    const expireAfterDays = parameters.expireAfterDays ? Number(parameters.expireAfterDays) : undefined;
    adminLogger.logInfo('Running script to configure online archive');

    // set up all the standard services in the container
    const container = createContainer();

    container.register(
        'processConfigureAuditEventOnlineArchiveRunner',
        (c) =>
            new ConfigureAuditEventOnlineArchiveRunner({
                mongoDatabaseManager: c.mongoDatabaseManager,
                adminLogger,
                collections,
                expireAfterDays
            })
    );

    const processConfigureAuditEventOnlineArchiveRunner = container.processConfigureAuditEventOnlineArchiveRunner;
    await processConfigureAuditEventOnlineArchiveRunner.processAsync();
    adminLogger.logInfo('Exiting process');
    process.exit(0);
}

/**
 * To run this:
 * nvm use
 * npm install
 * Create .env file in root directory with these variables
 * AUDIT_EVENT_MONGO_URL=
 * AUDIT_EVENT_MONGO_DB_NAME=
 * AUDIT_EVENT_MONGO_USERNAME=
 * AUDIT_EVENT_MONGO_PASSWORD=
 * AUDIT_EVENT_ONLINE_ARCHIVE_MANAGEMENT_API=
 * ONLINE_ARCHIVE_AUTHENTICATION_PUBLIC_KEY=
 * ONLINE_ARCHIVE_AUTHENTICATION_PRIVATE_KEY=
 * Command: node -r dotenv/config src/admin/scripts/configureAuditEventOnlineArchive.js
 * Command: node -r dotenv/config src/admin/scripts/configureAuditEventOnlineArchive.js --collections="AuditEvent_4_0_0_2023_09_09"
 * Command: node -r dotenv/config src/admin/scripts/configureAuditEventOnlineArchive.js --collections="AuditEvent_4_0_0_2023_09" --expireAfterDays=60
 */
main().catch((reason) => {
    console.error(reason);
});
