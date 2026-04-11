const { execSync } = require('child_process');

/**
 * Checks if MongoDB Docker container is running
 * @returns {boolean}
 */
function isMongoDBRunning() {
    try {
        const output = execSync('docker ps --format "{{.Names}}"', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        // docker-compose service name is "mongo", container name varies
        return output.split('\n').some(name => name.includes('mongo'));
    } catch (error) {
        return false;
    }
}

/**
 * Starts MongoDB container and waits for it to be ready
 * @param {number} [maxWaitMs=60000] - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} - True if started successfully
 */
async function startMongoDB(maxWaitMs = 60000) {
    console.log('Starting MongoDB container...');

    try {
        execSync('docker compose -f docker-compose-test.yml up -d mongo', {
            stdio: 'inherit',
            cwd: process.cwd()
        });
    } catch (error) {
        console.error('Failed to start MongoDB:', error.message);
        return false;
    }

    console.log('Waiting for MongoDB to be ready...');
    const startTime = Date.now();

    let delay = 200;
    while (Date.now() - startTime < maxWaitMs) {
        try {
            execSync(
                'docker exec $(docker ps -q --filter name=mongo) mongosh --eval "db.runCommand(\'ping\').ok" --quiet',
                { encoding: 'utf8', stdio: 'pipe', timeout: 2000 }
            );
            console.log('MongoDB is ready');
            return true;
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 1.5, 2000);
        }
    }

    console.error(`MongoDB failed to start within ${maxWaitMs}ms`);
    return false;
}

/**
 * Ensures MongoDB Docker container is running, starts it if needed.
 *
 * Sets USE_DOCKER_MONGO=1 and MONGO_URL so that TestMongoDatabaseManager
 * routes to Docker MongoDB instead of MongoMemoryServer.
 *
 * @param {object} [options]
 * @param {number} [options.maxWaitMs=60000]
 * @returns {Promise<boolean>}
 */
async function ensureMongoDB(options = {}) {
    const { maxWaitMs = 60000 } = options;

    // Set env vars so TestMongoDatabaseManager uses Docker MongoDB
    process.env.USE_DOCKER_MONGO = '1';
    process.env.MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';

    if (isMongoDBRunning()) {
        console.log('MongoDB container is already running');

        // Quick health check
        try {
            execSync(
                'docker exec $(docker ps -q --filter name=mongo) mongosh --eval "db.runCommand(\'ping\').ok" --quiet',
                { encoding: 'utf8', stdio: 'pipe', timeout: 2000 }
            );
            console.log('MongoDB is healthy');
            return true;
        } catch (error) {
            console.warn('MongoDB container running but not healthy:', error.message);
        }
    }

    return await startMongoDB(maxWaitMs);
}

module.exports = {
    isMongoDBRunning,
    startMongoDB,
    ensureMongoDB
};
