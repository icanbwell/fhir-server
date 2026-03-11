const { execSync, spawn } = require('child_process');
const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
const { ConfigManager } = require('../utils/configManager');

/**
 * Checks if ClickHouse container is running
 * @returns {boolean}
 */
function isClickHouseRunning() {
    try {
        const output = execSync('docker ps --format "{{.Names}}"', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return output.includes('fhir-clickhouse');
    } catch (error) {
        return false;
    }
}

/**
 * Starts ClickHouse container and waits for it to be ready
 * @param {number} [maxWaitMs=60000] - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} - True if started successfully
 */
async function startClickHouse(maxWaitMs = 60000) {
    console.log('Starting ClickHouse container...');

    try {
        execSync('docker-compose up -d clickhouse', {
            stdio: 'inherit',
            cwd: process.cwd()
        });
    } catch (error) {
        console.error('Failed to start ClickHouse:', error.message);
        return false;
    }

    console.log('Waiting for ClickHouse to be ready...');
    const startTime = Date.now();

    let delay = 200; // Start with 200ms
    while (Date.now() - startTime < maxWaitMs) {
        try {
            // Try to ping ClickHouse
            execSync('curl -s http://localhost:8123/ping', {
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 1000
            });
            console.log('✓ ClickHouse is ready');
            return true;
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 1.5, 2000); // Exponential backoff up to 2s
        }
    }

    console.error(`✗ ClickHouse failed to start within ${maxWaitMs}ms`);
    return false;
}

/**
 * Ensures ClickHouse is running, starts it if needed
 * @param {object} [options]
 * @param {number} [options.maxWaitMs=60000] - Maximum time to wait in milliseconds
 * @param {boolean} [options.skipIfDisabled=true] - Skip if ENABLE_CLICKHOUSE !== '1'
 * @returns {Promise<boolean>} - True if ClickHouse is ready
 */
async function ensureClickHouse(options = {}) {
    const { maxWaitMs = 60000, skipIfDisabled = true } = options;

    // Check if ClickHouse is enabled
    if (skipIfDisabled && process.env.ENABLE_CLICKHOUSE !== '1') {
        console.log('ClickHouse is disabled (ENABLE_CLICKHOUSE !== 1), skipping...');
        return true; // Not an error, just disabled
    }

    // Check if already running
    if (isClickHouseRunning()) {
        console.log('✓ ClickHouse container is already running');

        // Verify it's actually healthy
        try {
            const configManager = new ConfigManager();
            const manager = new ClickHouseClientManager({ configManager });
            await manager.getClientAsync();
            const isHealthy = await manager.isHealthyAsync();

            if (isHealthy) {
                console.log('✓ ClickHouse is healthy');
                return true;
            }
        } catch (error) {
            console.warn('ClickHouse container running but not healthy:', error.message);
        }
    }

    // Not running or not healthy, start it
    return await startClickHouse(maxWaitMs);
}

/**
 * Stops ClickHouse container
 */
function stopClickHouse() {
    console.log('Stopping ClickHouse container...');
    try {
        execSync('docker-compose stop clickhouse', {
            stdio: 'inherit',
            cwd: process.cwd()
        });
        console.log('✓ ClickHouse stopped');
    } catch (error) {
        console.error('Failed to stop ClickHouse:', error.message);
    }
}

module.exports = {
    isClickHouseRunning,
    startClickHouse,
    ensureClickHouse,
    stopClickHouse
};
