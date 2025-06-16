'use strict';

let ignoreUrls = ['/health', '/live', '/ready'];
if (process.env.OPENTELEMETRY_IGNORE_URLS) {
    ignoreUrls = ignoreUrls.concat(
        process.env.OPENTELEMETRY_IGNORE_URLS?.split(',')
    );
}

let instrumentationConfigs = {
    '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => ignoreUrls.includes(req.url),
        applyCustomAttributesOnSpan: (span) => {
            // For graphql urls we are using middlewares to process the graphql request, there is no route
            // attached with any http method so we have to add the route in the 'span' to aggregate
            // data on datadog and grafana
            if (span.attributes['http.target'] && span.attributes['http.target'].includes('/$')) {
                span.attributes['http.route'] = span.attributes['http.target'].replace(/\$/g, '([$])');
                // graphqlv2 path starts with base_version
                if (span.attributes['http.route'].includes('graphqlv2')) {
                    span.attributes['http.route'] = span.attributes['http.route'].replace('4_0_0', ':base_version')
                }
            }
        }
    },
    '@opentelemetry/instrumentation-mongodb': {
        enhancedDatabaseReporting: true,
        responseHook: (span) => {
            if (
                span.attributes['db.system'] === 'mongodb' &&
                !['find', 'aggregate'].includes(span.attributes['db.operation'])
            ) {
                delete span.attributes['db.statement'];
            }
        }
    }
}

if (process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.includes("/otel-auto-instrumentation-nodejs/autoinstrumentation.js")) {
    /**
     * Auto-instrumentation is enabled, SDK is already started. Configure instrumentations without starting a new SDK
     */
    const { registerInstrumentations } = require('@opentelemetry/instrumentation');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    registerInstrumentations({
        instrumentations: [
            getNodeAutoInstrumentations(instrumentationConfigs)
        ]
    });
} else {
    /**
     * We have to start the instrumentation SDK ourselves
     */
    const opentelemetry = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
    const { Resource } = require('@opentelemetry/resources');
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

    // Instrumentations
    const { DataloaderInstrumentation } = require('@opentelemetry/instrumentation-dataloader');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { GraphQLInstrumentation } = require('@opentelemetry/instrumentation-graphql');
    const { LruMemoizerInstrumentation } = require('@opentelemetry/instrumentation-lru-memoizer');
    const { RouterInstrumentation } = require('@opentelemetry/instrumentation-router');
    const { WinstonInstrumentation } = require('@opentelemetry/instrumentation-winston');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');

    const sdk = new opentelemetry.NodeSDK({
        resource: new Resource(),
        traceExporter: new OTLPTraceExporter(),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter()
        }),
        instrumentations: [
            new DataloaderInstrumentation(),
            new ExpressInstrumentation(),
            new LruMemoizerInstrumentation(),
            new RouterInstrumentation(),
            new WinstonInstrumentation(),
            new HttpInstrumentation(instrumentationConfigs['@opentelemetry/instrumentation-http']),
            new MongoDBInstrumentation(instrumentationConfigs['@opentelemetry/instrumentation-mongodb'])
        ]
    });

    sdk.start();
}

