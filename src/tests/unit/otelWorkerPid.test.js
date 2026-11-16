'use strict';

/**
 * Worker pid on HTTP server spans (INC-357 follow-up).
 *
 * fhir-server runs in Node cluster mode, so one pod serves requests from several worker
 * processes. Runtime and pool metrics carry the worker's pid as process_pid (from the SDK's
 * process.pid resource attribute). This suite drives a real HTTP request through the real http
 * instrumentation, configured by src/otel_instrumentation.js, and asserts the exported server
 * span carries the same process.pid key.
 *
 * Only the external boundaries are mocked: the OTLP exporters, the NodeSDK start (so no
 * collector connection is attempted) and Sentry's context manager. The span is recorded by a
 * real tracer provider into an in-memory exporter.
 */

const http = require('http');
const { describe, test, expect, beforeAll, afterAll, jest: jestGlobal } = require('@jest/globals');

describe('otel_instrumentation.js worker pid on server spans', () => {
    let httpInstrumentation;
    let httpModuleDefinition;
    let provider;
    let exporter;
    let server;

    beforeAll(async () => {
        delete process.env.NODE_OPTIONS;
        let sdkConfig;
        jestGlobal.doMock('@opentelemetry/sdk-node', () => ({
            NodeSDK: jestGlobal.fn().mockImplementation(function (config) {
                sdkConfig = config;
                return { start: jestGlobal.fn() };
            })
        }));
        jestGlobal.doMock('@opentelemetry/exporter-trace-otlp-grpc', () => ({ OTLPTraceExporter: jestGlobal.fn() }));
        jestGlobal.doMock('@opentelemetry/exporter-metrics-otlp-grpc', () => ({ OTLPMetricExporter: jestGlobal.fn() }));
        jestGlobal.doMock('@sentry/node', () => ({ SentryContextManager: jestGlobal.fn() }));

        jestGlobal.isolateModules(() => {
            require('../../otel_instrumentation');
        });
        httpInstrumentation = sdkConfig.instrumentations.find(
            (i) => i.instrumentationName === '@opentelemetry/instrumentation-http'
        );

        const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
        const { InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
        exporter = new InMemorySpanExporter();
        provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
        httpInstrumentation.setTracerProvider(provider);
        // Jest's module loader bypasses the require hook OTel normally patches through, so apply
        // the instrumentation's own http patch to the core module directly.
        httpModuleDefinition = httpInstrumentation.getModuleDefinitions().find((d) => d.name === 'http');
        httpModuleDefinition.patch(http);

        server = http.createServer((req, res) => res.end('ok'));
        await new Promise((resolve) => server.listen(0, resolve));
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
        httpModuleDefinition.unpatch(http);
        await provider.shutdown();
    });

    test('the server span for an incoming request carries the worker pid as process.pid', async () => {
        const { port } = server.address();
        await new Promise((resolve, reject) => {
            http.get(`http://127.0.0.1:${port}/4_0_0/Patient`, (res) => {
                res.resume();
                res.on('end', resolve);
            }).on('error', reject);
        });
        await new Promise((resolve) => setImmediate(resolve));

        const { SpanKind } = require('@opentelemetry/api');
        const serverSpans = exporter.getFinishedSpans().filter((s) => s.kind === SpanKind.SERVER);
        expect(serverSpans).toHaveLength(1);
        expect(serverSpans[0].attributes['process.pid']).toBe(process.pid);
    });
});
