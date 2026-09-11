const { GenericContainer, Wait } = require('testcontainers');
const { MongoClient } = require('mongodb');
const { withNockSuspended, setEnvVars, restoreEnvVars } = require('./testContainerUtils');
const { createAllAtlasSearchIndexesAsync } = require('../../admin/scripts/atlasSearchIndexHelper');

const MONGO_IMAGE = 'mongodb/mongodb-atlas-local:8.2.5';
const MONGO_PORT = 27017;
const STARTUP_TIMEOUT_MS = 60000;
const DB_NAME = 'fhir';

/** @type {import('testcontainers').StartedTestContainer|null} */
let startedContainer = null;
/** @type {Record<string, string|undefined>|null} */
let savedEnvVars = null;

/**
 * Minimal logger matching the {logInfo} shape atlasSearchIndexHelper expects, without pulling
 * in the app's full Winston setup -- this runner starts before any app container exists.
 */
const consoleAdminLogger = { logInfo: (message) => console.log(`[atlasSearchTestRunner] ${message}`) };

/**
 * testcontainers lazily starts a shared "Ryuk" reaper container on its first-ever use in the
 * process. Ryuk itself needs to reach the Docker daemon at a path it can infer -- on a
 * non-standard host (e.g. Colima, which exposes the socket at
 * ~/.colima/default/docker.sock, not /var/run/docker.sock), that inference fails unless this is
 * set first. clickHouseTestRunner.js already sets this before its own testcontainers usage, but
 * since this runner's container starts first in this suite's globalSetup, Ryuk would otherwise
 * start (and fail) before that ever runs.
 */
function applyRequiredTestcontainersEnv () {
    if (process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE === undefined) {
        process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = '/var/run/docker.sock';
    }
}

/**
 * Starts a real MongoDB Atlas Search deployment (mongodb-atlas-local, the same image
 * docker-compose.yml uses for local dev) for the duration of this Jest run, creates the three
 * FHIR resource collections this feature searches, creates the hybrid-full-text-search index on
 * each (see src/admin/scripts/atlasSearchIndexHelper.js), and points USE_DOCKER_MONGO/MONGO_URL
 * at it so the existing mongoTestRunner.js/TestMongoDatabaseManager escape hatch picks it up
 * transparently -- no changes needed to either of those files.
 *
 * Connects with `directConnection=true`: this image runs as a single-node replica set that
 * self-registers under an internal hostname unreachable from the test-runner process (which is
 * not itself a container on the same Docker network) -- confirmed against
 * person-matching-service's own testcontainers setup (tests/containers/mongodb.py), which hit
 * and documented this exact issue.
 *
 * @returns {Promise<void>}
 */
async function startTestAtlasSearchMongoAsync () {
    if (startedContainer) {
        return;
    }
    applyRequiredTestcontainersEnv();

    startedContainer = await withNockSuspended(() => {
        const container = new GenericContainer(MONGO_IMAGE)
            .withExposedPorts(MONGO_PORT)
            .withEnvironment({ DO_NOT_TRACK: '1' })
            .withWaitStrategy(Wait.forSuccessfulCommand('runner healthcheck'))
            .withStartupTimeout(STARTUP_TIMEOUT_MS);

        return container.start();
    });

    const host = startedContainer.getHost();
    const port = startedContainer.getMappedPort(MONGO_PORT);
    const mongoUrl = `mongodb://${host}:${port}/?directConnection=true`;

    savedEnvVars = setEnvVars({
        USE_DOCKER_MONGO: '1',
        MONGO_URL: mongoUrl
    });

    await createCollectionsAndIndexesAsync(mongoUrl);
}

/**
 * Creates the Patient_4_0_0/Person_4_0_0/Practitioner_4_0_0 collections (createSearchIndex fails
 * on a collection that doesn't exist yet -- an empty test database has none of them) and the
 * hybrid-full-text-search Atlas Search index on each.
 * @param {string} mongoUrl
 * @returns {Promise<void>}
 */
async function createCollectionsAndIndexesAsync (mongoUrl) {
    const client = new MongoClient(mongoUrl);
    try {
        await client.connect();
        const db = client.db(DB_NAME);

        await createAllAtlasSearchIndexesAsync({
            getCollectionAsync: async (resourceType) => {
                const collectionName = `${resourceType}_4_0_0`;
                await db.createCollection(collectionName).catch((err) => {
                    // Already exists (e.g. a prior test run against the same container) -- fine.
                    if (err.codeName !== 'NamespaceExists') {
                        throw err;
                    }
                });
                return db.collection(collectionName);
            },
            adminLogger: consoleAdminLogger
        });
    } finally {
        await client.close();
    }
}

/**
 * Stops the shared Atlas Search Mongo container, if one was started, and restores the env vars
 * it overrode.
 * @returns {Promise<void>}
 */
async function stopTestAtlasSearchMongoAsync () {
    if (startedContainer) {
        const container = startedContainer;
        startedContainer = null;
        await withNockSuspended(() => container.stop());
    }
    if (savedEnvVars) {
        restoreEnvVars(savedEnvVars);
        savedEnvVars = null;
    }
}

module.exports = {
    startTestAtlasSearchMongoAsync,
    stopTestAtlasSearchMongoAsync
};
