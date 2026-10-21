// Makes each test file's nock instance the owner of the global http interceptor,
// so nock.restore() — and therefore withNockSuspended() — actually works in
// every test file, not just the first one in the process.
//
// Why: Jest gives every test file a fresh module registry, so each file loads
// its own copy of nock. nock v14's @mswjs/interceptors ClientRequest interceptor
// is process-global, though: the first copy to load patches http and owns it;
// later copies find that running instance and merely subscribe to it. Their
// restore() only unsubscribes, leaving http patched. Since files never restore
// nock at the end, the first file's interceptor stays installed for the rest of
// the --runInBand process, and withNockSuspended() (patchClickHouseManager.js,
// groupTestSetup.js) silently stops suspending anything. ClickHouse and
// supertest traffic then run through MockHttpSocket passthroughs whose shared fd
// intermittently fails with `read EINVAL`, aborting whichever suite is running
// — which one depends on shard composition.
//
// Fix: before this file loads anything, restore the previous file's nock (the
// current owner, which disposes the global interceptor), then load nock so this
// file's copy becomes the owner. The handle is carried on the `http` core module
// because core modules — unlike module registries and test globals — are shared
// across test files.
//
// Loaded first in jest.config.js `setupFiles`.
const http = require('http');

const ACTIVE_NOCK = Symbol.for('fhir-server.test.activeNock');

const previousNock = http[ACTIVE_NOCK];
if (previousNock && previousNock.isActive()) {
    previousNock.restore();
}

http[ACTIVE_NOCK] = require('nock');
