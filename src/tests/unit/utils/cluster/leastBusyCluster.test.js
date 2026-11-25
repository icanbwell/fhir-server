'use strict';

/**
 * Runs a real cluster primary and workers in a child process (fixtures/leastBusyClusterFixture.js)
 * and drives it over real HTTP: the socket hand-off over IPC, load reports, avoiding a blocked
 * worker, and graceful shutdown through Terminus.
 */
const http = require('http');
const path = require('path');
const { fork } = require('child_process');
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

const FIXTURE = path.join(__dirname, 'fixtures', 'leastBusyClusterFixture.js');

/**
 * @param {number} port
 * @param {string} urlPath
 * @returns {Promise<{pid: string, ms: number}>}
 */
const get = (port, urlPath) =>
    new Promise((resolve, reject) => {
        const started = Date.now();
        http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, (res) => {
            res.resume();
            res.on('end', () =>
                resolve({ pid: res.headers['x-worker-pid'], ms: Date.now() - started })
            );
        }).on('error', reject);
    });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('least-busy cluster (real processes)', () => {
    let child;
    let port;
    const events = [];
    let exited;

    beforeAll(async () => {
        child = fork(FIXTURE, [], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
        exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
        let buffered = '';
        port = await new Promise((resolve, reject) => {
            child.once('exit', () => reject(new Error('fixture exited before listening')));
            child.stdout.on('data', (chunk) => {
                buffered += chunk;
                let newline;
                while ((newline = buffered.indexOf('\n')) >= 0) {
                    const line = buffered.slice(0, newline);
                    buffered = buffered.slice(newline + 1);
                    const event = JSON.parse(line);
                    events.push(event);
                    if (event.event === 'listening') {
                        resolve(event.port);
                    }
                }
            });
        });
    }, 30000);

    afterAll(() => {
        if (child && child.exitCode === null) {
            child.kill('SIGKILL');
        }
    });

    test('serves requests on more than one worker', async () => {
        const pids = new Set();
        for (let i = 0; i < 12; i++) {
            pids.add((await get(port, '/fast')).pid);
        }

        expect(pids.size).toBeGreaterThan(1);
    });

    test('sends a request to an idle worker instead of one blocked on a slow request', async () => {
        const slow = get(port, '/slow');
        // give the slow request time to reach its worker and start blocking
        await sleep(30);

        const fast = await get(port, '/fast');
        const { pid: slowPid } = await slow;

        expect(fast.pid).not.toBe(slowPid);
        // round-robin would have queued it behind the 150 ms block in one case in three
        expect(fast.ms).toBeLessThan(100);
    });

    test('shuts down gracefully: every worker flushes and exits 0, then the primary exits', async () => {
        child.kill('SIGTERM');

        const code = await exited;

        expect(code).toBe(0);
        expect(events.filter((e) => e.event === 'flushed')).toHaveLength(3);
        expect(events.filter((e) => e.event === 'workerExit').map((e) => e.code)).toEqual([0, 0, 0]);
    }, 30000);
});
