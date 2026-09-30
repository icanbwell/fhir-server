'use strict';

/**
 * Tests for src/otel_instrumentation.js -- loaded via `--require=./src/otel_instrumentation.js`
 * before the app starts. It has NO exports (it's a pure bootstrap script for the OpenTelemetry
 * SDK), so its real per-request logic (the ignoreIncomingRequestHook, applyCustomAttributesOnSpan,
 * and MongoDB responseHook closures passed into the instrumentation constructors) can only be
 * exercised by mocking the instrumentation/SDK packages, capturing the config object each real
 * constructor/function receives, and invoking the captured hook functions directly. That
 * satisfies RULE 22 (import -> instantiate -> call -> assert): requiring the file IS the
 * "instantiate" step (it runs the real module-level code that builds and passes these hooks), and
 * each test then CALLS the captured hook with real inputs and asserts on its output/side effect.
 *
 * Every OpenTelemetry/Sentry package this file requires is an external infrastructure dependency
 * (trace/metric exporters, auto-instrumentation registration) and is mocked with `{ virtual: true }`
 * so no real network exporter or SDK is started.
 *
 * Domain invariants exercised here:
 *  - ignoreIncomingRequestHook must exclude exactly the configured health-check paths from
 *    tracing (default: /health, /live, /ready) plus anything from OPENTELEMETRY_IGNORE_URLS.
 *  - applyCustomAttributesOnSpan rewrites http.route only for GraphQL spans (http.target
 *    containing '/$graphql'), replacing the FHIR base-version segment with the generic
 *    ':base_version' placeholder used for span aggregation.
 *  - The MongoDB responseHook strips db.statement (which can contain full query bodies/PHI)
 *    for every operation EXCEPT 'find'/'aggregate', and only when db.system is 'mongodb'.
 *  - When NODE_OPTIONS already points at the auto-instrumentation loader, this file must
 *    registerInstrumentations() with getNodeAutoInstrumentations() and must NOT also start a
 *    second, manually-configured NodeSDK (that would double-instrument every request).
 */

const { describe, test, expect, beforeEach, afterEach, jest: jestGlobal } = require('@jest/globals');

describe('otel_instrumentation.js', () => {
    let originalIgnoreUrls;
    let originalNodeOptions;

    beforeEach(() => {
        originalIgnoreUrls = process.env.OPENTELEMETRY_IGNORE_URLS;
        originalNodeOptions = process.env.NODE_OPTIONS;
        delete process.env.OPENTELEMETRY_IGNORE_URLS;
        delete process.env.NODE_OPTIONS;
    });

    afterEach(() => {
        if (originalIgnoreUrls === undefined) {
            delete process.env.OPENTELEMETRY_IGNORE_URLS;
        } else {
            process.env.OPENTELEMETRY_IGNORE_URLS = originalIgnoreUrls;
        }
        if (originalNodeOptions === undefined) {
            delete process.env.NODE_OPTIONS;
        } else {
            process.env.NODE_OPTIONS = originalNodeOptions;
        }
        jestGlobal.restoreAllMocks();
    });

    /**
     * Loads src/otel_instrumentation.js fresh with every OTel/Sentry dependency mocked, and
     * returns the captured constructor/function arguments so hook closures can be invoked
     * directly.
     */
    function loadOtelInstrumentation () {
        const captured = {};

        captured.sdkStartMock = jestGlobal.fn();
        captured.NodeSDK = jestGlobal.fn().mockImplementation(function () {
            return { start: captured.sdkStartMock };
        });
        captured.HttpInstrumentation = jestGlobal.fn();
        captured.MongoDBInstrumentation = jestGlobal.fn();
        captured.registerInstrumentations = jestGlobal.fn();
        captured.getNodeAutoInstrumentations = jestGlobal.fn().mockReturnValue([]);

        jestGlobal.doMock('@opentelemetry/instrumentation', () => ({
            registerInstrumentations: captured.registerInstrumentations
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/auto-instrumentations-node', () => ({
            getNodeAutoInstrumentations: captured.getNodeAutoInstrumentations
        }), { virtual: true });
        jestGlobal.doMock('@sentry/node', () => ({
            SentryContextManager: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/sdk-node', () => ({ NodeSDK: captured.NodeSDK }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/exporter-trace-otlp-grpc', () => ({
            OTLPTraceExporter: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/exporter-metrics-otlp-grpc', () => ({
            OTLPMetricExporter: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/sdk-metrics', () => ({
            PeriodicExportingMetricReader: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-dataloader', () => ({
            DataloaderInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-express', () => ({
            ExpressInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-graphql', () => ({
            GraphQLInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-lru-memoizer', () => ({
            LruMemoizerInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-winston', () => ({
            WinstonInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-http', () => ({
            HttpInstrumentation: captured.HttpInstrumentation
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-mongodb', () => ({
            MongoDBInstrumentation: captured.MongoDBInstrumentation
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-redis', () => ({
            RedisInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-runtime-node', () => ({
            RuntimeNodeInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-kafkajs', () => ({
            KafkaJsInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/instrumentation-aws-sdk', () => ({
            AwsInstrumentation: jestGlobal.fn()
        }), { virtual: true });
        jestGlobal.doMock('@opentelemetry/core', () => ({
            W3CTraceContextPropagator: jestGlobal.fn(),
            W3CBaggagePropagator: jestGlobal.fn(),
            CompositePropagator: jestGlobal.fn()
        }), { virtual: true });

        jestGlobal.isolateModules(() => {
            require('../../otel_instrumentation');
        });

        return captured;
    }

    test('manual SDK path (default, no auto-instrumentation NODE_OPTIONS): constructs and starts a NodeSDK', () => {
        const { NodeSDK, sdkStartMock } = loadOtelInstrumentation();
        expect(NodeSDK).toHaveBeenCalledTimes(1);
        expect(sdkStartMock).toHaveBeenCalledTimes(1);
    });

    test('ignoreIncomingRequestHook excludes the default health-check paths from tracing', () => {
        const { HttpInstrumentation } = loadOtelInstrumentation();
        const httpConfig = HttpInstrumentation.mock.calls[0][0];

        expect(httpConfig.ignoreIncomingRequestHook({ url: '/health' })).toBe(true);
        expect(httpConfig.ignoreIncomingRequestHook({ url: '/live' })).toBe(true);
        expect(httpConfig.ignoreIncomingRequestHook({ url: '/ready' })).toBe(true);
        expect(httpConfig.ignoreIncomingRequestHook({ url: '/4_0_0/Patient/123' })).toBe(false);
    });

    test('ignoreIncomingRequestHook additionally excludes URLs listed in OPENTELEMETRY_IGNORE_URLS', () => {
        process.env.OPENTELEMETRY_IGNORE_URLS = '/custom-probe,/metrics';
        const { HttpInstrumentation } = loadOtelInstrumentation();
        const httpConfig = HttpInstrumentation.mock.calls[0][0];

        expect(httpConfig.ignoreIncomingRequestHook({ url: '/custom-probe' })).toBe(true);
        expect(httpConfig.ignoreIncomingRequestHook({ url: '/metrics' })).toBe(true);
        // Still excludes the built-in defaults on top of the custom ones (concat, not replace).
        expect(httpConfig.ignoreIncomingRequestHook({ url: '/health' })).toBe(true);
        expect(httpConfig.ignoreIncomingRequestHook({ url: '/unrelated' })).toBe(false);
    });

    test('a space after the comma in OPENTELEMETRY_IGNORE_URLS breaks the match for that entry', () => {
        // `.split(',')` is used with no `.map(x => x.trim())` (contrast with INV-H1-3's batch of
        // CLI list arguments, which DO trim). An operator writing the common, human-friendly
        // "/foo, /bar" form silently gets an entry that never matches any real request path,
        // because req.url is never observed with a leading space -- so tracing keeps emitting
        // spans (and any associated cost/noise) for a URL the operator explicitly tried to
        // silence. Correct behavior: each configured entry should match regardless of
        // surrounding whitespace.
        process.env.OPENTELEMETRY_IGNORE_URLS = '/custom-probe, /metrics';
        const { HttpInstrumentation } = loadOtelInstrumentation();
        const httpConfig = HttpInstrumentation.mock.calls[0][0];

        // FAILS on current code: ignoreUrls contains ' /metrics' (with a leading space), so a
        // request for the real path '/metrics' is NOT recognized as ignored.
        expect(httpConfig.ignoreIncomingRequestHook({ url: '/metrics' })).toBe(true);
    });

    test('applyCustomAttributesOnSpan rewrites http.route for GraphQL spans, replacing the FHIR base-version segment', () => {
        const { HttpInstrumentation } = loadOtelInstrumentation();
        const httpConfig = HttpInstrumentation.mock.calls[0][0];

        const span = { attributes: { 'http.target': '/4_0_0/$graphql' } };
        httpConfig.applyCustomAttributesOnSpan(span);

        expect(span.attributes['http.route']).toBe('/:base_version/$graphql');
    });

    test('applyCustomAttributesOnSpan leaves http.route untouched for non-GraphQL spans', () => {
        const { HttpInstrumentation } = loadOtelInstrumentation();
        const httpConfig = HttpInstrumentation.mock.calls[0][0];

        const span = { attributes: { 'http.target': '/4_0_0/Patient/123' } };
        httpConfig.applyCustomAttributesOnSpan(span);

        expect(span.attributes['http.route']).toBeUndefined();
    });

    test('applyCustomAttributesOnSpan does not throw when span.attributes is missing', () => {
        const { HttpInstrumentation } = loadOtelInstrumentation();
        const httpConfig = HttpInstrumentation.mock.calls[0][0];

        expect(() => httpConfig.applyCustomAttributesOnSpan({})).not.toThrow();
    });

    test('MongoDB responseHook strips db.statement for non-find/aggregate operations on mongodb spans', () => {
        const { MongoDBInstrumentation } = loadOtelInstrumentation();
        const mongoConfig = MongoDBInstrumentation.mock.calls[0][0];

        const span = { attributes: { 'db.system': 'mongodb', 'db.operation': 'update', 'db.statement': '{"q":1}' } };
        mongoConfig.responseHook(span);

        expect(span.attributes['db.statement']).toBeUndefined();
    });

    test('MongoDB responseHook PRESERVES db.statement for find/aggregate operations', () => {
        const { MongoDBInstrumentation } = loadOtelInstrumentation();
        const mongoConfig = MongoDBInstrumentation.mock.calls[0][0];

        const findSpan = { attributes: { 'db.system': 'mongodb', 'db.operation': 'find', 'db.statement': '{"q":1}' } };
        mongoConfig.responseHook(findSpan);
        expect(findSpan.attributes['db.statement']).toBe('{"q":1}');

        const aggSpan = { attributes: { 'db.system': 'mongodb', 'db.operation': 'aggregate', 'db.statement': '{"q":2}' } };
        mongoConfig.responseHook(aggSpan);
        expect(aggSpan.attributes['db.statement']).toBe('{"q":2}');
    });

    test('MongoDB responseHook leaves db.statement alone when db.system is not "mongodb"', () => {
        const { MongoDBInstrumentation } = loadOtelInstrumentation();
        const mongoConfig = MongoDBInstrumentation.mock.calls[0][0];

        const span = { attributes: { 'db.system': 'other', 'db.operation': 'update', 'db.statement': '{"q":1}' } };
        mongoConfig.responseHook(span);

        expect(span.attributes['db.statement']).toBe('{"q":1}');
    });

    test('auto-instrumentation path: when NODE_OPTIONS points at the autoinstrumentation loader, registers via getNodeAutoInstrumentations and does NOT start a second manual NodeSDK', () => {
        process.env.NODE_OPTIONS = '--require /otel-auto-instrumentation-nodejs/autoinstrumentation.js';
        const { registerInstrumentations, getNodeAutoInstrumentations, NodeSDK } = loadOtelInstrumentation();

        expect(getNodeAutoInstrumentations).toHaveBeenCalledTimes(1);
        expect(registerInstrumentations).toHaveBeenCalledTimes(1);
        expect(registerInstrumentations.mock.calls[0][0].instrumentations).toEqual([[]]);
        // Double-instrumentation guard: the manual SDK branch must not also run.
        expect(NodeSDK).not.toHaveBeenCalled();
    });

    test('the instrumentation-router auto-instrumentation is explicitly disabled in the config passed to getNodeAutoInstrumentations', () => {
        process.env.NODE_OPTIONS = '--require /otel-auto-instrumentation-nodejs/autoinstrumentation.js';
        const { getNodeAutoInstrumentations } = loadOtelInstrumentation();

        const configArg = getNodeAutoInstrumentations.mock.calls[0][0];
        expect(configArg['@opentelemetry/instrumentation-router'].enabled).toBe(false);
        expect(configArg['@opentelemetry/instrumentation-runtime-node'].enabled).toBe(true);
    });
});
