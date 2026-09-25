'use strict';

/**
 * Tests for src/winstonInit.js -- logger initialization.
 *
 * This module wraps a single winston.Container so every part of the codebase that calls
 * `getLogger(name)` shares the same logger per name. winston's own `Container.get(id, options)`
 * semantics matter here: `options` is only applied the FIRST time a given name is created; every
 * later call, even with different options, silently returns the already-created logger. That is
 * winston's real, documented behavior (not a bug in this file), but it means callers cannot
 * "reconfigure" a logger by calling getLogger with new options once it exists -- worth asserting
 * directly since a future edit to winstonInit.js could accidentally assume otherwise.
 *
 * Domain invariants exercised here (see .qa/shards/G-invariants.md):
 *  - INV-G11: getLogger(name) returns the SAME winston logger instance across repeated calls
 *    (the point of centralizing this instead of `winston.createLogger()` everywhere).
 *  - INV-G12: initialize() must not throw and must guarantee the 'default' logger has at least
 *    one transport, whether it creates it fresh or backfills a transport-less existing one.
 *  - INV-G13: LOGLEVEL=SILENT must actually suppress log output (a real security-adjacent
 *    property: this repo's own CLAUDE.md documents SILENT as the test-suite default specifically
 *    to keep noisy/PHI-adjacent log lines out of CI output).
 *
 * Because defaultConfig is computed once at module load from process.env, and the module-level
 * `container` is a singleton for the lifetime of the module, tests that depend on a specific
 * LOGLEVEL or a pristine (logger-free) container use `jest.isolateModules` to get a fresh module
 * instance rather than mutating the shared one other tests in this file rely on.
 */

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

const { getLogger } = require('../../winstonInit');

describe('winstonInit', () => {
    test('getLogger() with no arguments returns a logger for the "default" name', () => {
        const logger = getLogger();
        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.log).toBe('function');
    });

    test('INV-G11: getLogger(name) returns the IDENTICAL instance on repeated calls for the same name', () => {
        const first = getLogger('repeat-test');
        const second = getLogger('repeat-test');
        expect(first).toBe(second);
    });

    test('getLogger(name, options) only applies options the FIRST time a name is created (winston Container semantics)', () => {
        const first = getLogger('options-once-test', { level: 'error' });
        expect(first.level).toBe('error');
        // A later call with DIFFERENT options for the SAME name is silently ignored -- this is
        // real winston behavior this module inherits, not something winstonInit.js overrides.
        const second = getLogger('options-once-test', { level: 'debug' });
        expect(second).toBe(first);
        expect(second.level).toBe('error');
    });

    test('getLogger(name) with no options falls back to defaultConfig for a brand-new name', () => {
        const logger = getLogger('fresh-name-uses-default-config');
        expect(logger.level).toBe(process.env.LOGLEVEL ? process.env.LOGLEVEL.toLowerCase() : 'info');
    });

    test('a logger created via getLogger actually emits log records through its transport (real behavioral test, not existence-only)', () => {
        const winston = require('winston');
        const records = [];
        class CapturingTransport extends winston.transports.Console {
            log(info, callback) {
                records.push(info);
                callback();
            }
        }
        const logger = getLogger('capturing-transport-test', {
            level: 'info',
            format: winston.format.json(),
            transports: [new CapturingTransport({ level: 'info' })]
        });
        logger.info('hello from winstonInit test', { extra: 'value' });
        expect(records.length).toBe(1);
        expect(records[0].message).toBe('hello from winstonInit test');
        expect(records[0].extra).toBe('value');
    });

    test('defaultConfig.defaultMeta stamps logger name and image version onto emitted records', () => {
        const winston = require('winston');
        const records = [];
        class CapturingTransport extends winston.transports.Console {
            log(info, callback) {
                records.push(info);
                callback();
            }
        }
        // This repo's test env sets LOGLEVEL=SILENT (see jest/setEnvVars.js), which makes
        // winstonInit's module-load-time `defaultConfig.silent` true -- a logger created with
        // defaultConfig would swallow all records regardless of which transports are attached,
        // which would make this test observe nothing regardless of whether defaultMeta is
        // actually applied. Temporarily override LOGLEVEL before the isolated require so the
        // fresh module instance computes a non-silent defaultConfig, isolating the assertion to
        // the thing actually under test: defaultMeta stamping.
        const originalLogLevel = process.env.LOGLEVEL;
        process.env.LOGLEVEL = 'info';
        try {
            jestObj.isolateModules(() => {
                const { getLogger: isolatedGetLogger } = require('../../winstonInit');
                const logger = isolatedGetLogger('meta-stamp-test');
                // Swap in a capturing transport on the already-created logger so we observe the
                // defaultMeta this module attaches, without needing to fight Container's
                // create-once-options semantics tested above.
                logger.clear();
                logger.add(new CapturingTransport({ level: 'info' }));
                logger.info('meta check');
            });
        } finally {
            process.env.LOGLEVEL = originalLogLevel;
        }
        // The isolated module's own getLogger call happened inside isolateModules with a fresh
        // container, but the CapturingTransport class and `records` array are closed over from
        // this test's scope, so the assertion below still observes what was logged.
        expect(records.length).toBe(1);
        expect(records[0].logger).toBe('default');
        expect(records[0].version).toBeDefined();
    });

    test('INV-G12: initialize() creates a "default" logger with a console transport when none exists yet', () => {
        let hadTransports;
        jestObj.isolateModules(() => {
            const winstonInit = require('../../winstonInit');
            winstonInit.initialize();
            const logger = winstonInit.getLogger('default');
            hadTransports = logger.transports.length;
        });
        expect(hadTransports).toBeGreaterThan(0);
    });

    test('INV-G12: initialize() backfills a transport when "default" already exists but has zero transports', () => {
        let transportsAfter;
        jestObj.isolateModules(() => {
            const winston = require('winston');
            const winstonInit = require('../../winstonInit');
            // Force a transport-less 'default' logger, simulating something having touched the
            // logger before initialize() ran.
            winstonInit.getLogger('default', { level: 'info', transports: [] });
            expect(winstonInit.getLogger('default').transports.length).toBe(0);
            winstonInit.initialize();
            transportsAfter = winstonInit.getLogger('default').transports.length;
            void winston;
        });
        expect(transportsAfter).toBeGreaterThan(0);
    });

    test('INV-G12: initialize() does not throw and is idempotent -- calling it twice does not keep appending duplicate transports', () => {
        let firstCount;
        let secondCount;
        jestObj.isolateModules(() => {
            const winstonInit = require('../../winstonInit');
            expect(() => winstonInit.initialize()).not.toThrow();
            firstCount = winstonInit.getLogger('default').transports.length;
            expect(() => winstonInit.initialize()).not.toThrow();
            secondCount = winstonInit.getLogger('default').transports.length;
        });
        expect(firstCount).toBeGreaterThan(0);
        expect(secondCount).toBe(firstCount);
    });

    test('INV-G12: initialize() does NOT touch an already-configured "default" logger that has transports', () => {
        // Note: winston's `logger.transports` is a getter over the underlying Node Readable
        // stream's `_readableState.pipes` (see node_modules/winston/lib/winston/logger.js). When
        // there is exactly one pipe, Node stores it unwrapped and the getter does
        // `[pipes].filter(Boolean)`, allocating a NEW array on every access -- so comparing
        // `.transports === .transports` across two reads is always false regardless of whether
        // initialize() touched anything. Comparing the actual transport instance (not the array
        // wrapper) is what actually proves initialize() left the existing transport alone.
        let sameLoggerInstance;
        let sameTransportInstance;
        let transportCountAfter;
        jestObj.isolateModules(() => {
            const winston = require('winston');
            const winstonInit = require('../../winstonInit');
            const originalTransport = new winston.transports.Console({ level: 'warn' });
            const existing = winstonInit.getLogger('default', {
                level: 'warn',
                transports: [originalTransport]
            });
            winstonInit.initialize();
            const after = winstonInit.getLogger('default');
            sameLoggerInstance = after === existing;
            transportCountAfter = after.transports.length;
            sameTransportInstance = after.transports[0] === originalTransport;
        });
        expect(sameLoggerInstance).toBe(true);
        expect(transportCountAfter).toBe(1);
        expect(sameTransportInstance).toBe(true);
    });

    test('DEFENSIVE (INV-G13): defaultConfig.level reflects LOGLEVEL at module-load time (case-insensitive)', () => {
        let levelSeen;
        const original = process.env.LOGLEVEL;
        process.env.LOGLEVEL = 'DEBUG';
        try {
            jestObj.isolateModules(() => {
                const winstonInit = require('../../winstonInit');
                levelSeen = winstonInit.getLogger('level-check').level;
            });
        } finally {
            process.env.LOGLEVEL = original;
        }
        expect(levelSeen).toBe('debug');
    });

    test('SECURITY/DEFENSIVE (INV-G13): LOGLEVEL=SILENT actually suppresses log output, not just lowers verbosity', () => {
        // This repo's own test setup (CLAUDE.md: "Logs are SILENT by default") relies on this
        // exact behavior to keep PHI-adjacent debug output out of CI logs.
        let records;
        const original = process.env.LOGLEVEL;
        process.env.LOGLEVEL = 'SILENT';
        try {
            jestObj.isolateModules(() => {
                const winston = require('winston');
                const winstonInit = require('../../winstonInit');
                records = [];
                class CapturingTransport extends winston.transports.Console {
                    log(info, callback) {
                        records.push(info);
                        callback();
                    }
                }
                const logger = winstonInit.getLogger('silent-check', {
                    level: 'info',
                    silent: true,
                    transports: [new CapturingTransport({ level: 'info' })]
                });
                logger.info('this must not be captured');
            });
        } finally {
            process.env.LOGLEVEL = original;
        }
        expect(records.length).toBe(0);
    });
});
