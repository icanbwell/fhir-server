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
            // update the http.target attribute to replace the base_version with the actual version of the service, this
            // is needed to aggregate the data in the same span as we are using the same route for all versions of the service
            if (span.attributes['span.name'] && span.attributes['span.name'].includes(':base_version')) {
                span.attributes['span.name'] = span.attributes['span.name'].replace(':base_version', '4_0_0');
            }
            // For graphql urls we are using middlewares to process the graphql request, there is no route
            // attached with any http method so we have to add the route in the 'span' to aggregate data
            if (span.attributes['http.target'].includes('/$graphql')) {
                if (span.attributes['span.name'] && span.attributes['span.name'].includes('/\\$graphqlv2')) {
                    span.attributes['span.name'] = span.attributes['span.name'].replace('/\\$graphqlv2', '/$graphqlv2');
                }
                span.attributes['http.route'] = span.attributes['http.target']
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
    const Sentry = require('@sentry/node');

    const opentelemetry = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
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
    const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');

    const sdk = new opentelemetry.NodeSDK({
        traceExporter: new OTLPTraceExporter(),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter()
        }),
        instrumentations: [
            new HttpInstrumentation(instrumentationConfigs['@opentelemetry/instrumentation-http']),
            new ExpressInstrumentation(),
            new RouterInstrumentation(),
            new DataloaderInstrumentation(),
            new LruMemoizerInstrumentation(),
            new WinstonInstrumentation(),
            new GraphQLInstrumentation(),
            new MongoDBInstrumentation(instrumentationConfigs['@opentelemetry/instrumentation-mongodb']),
            new RedisInstrumentation()
        ],
        // Config needed for Sentry integration
        // https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/custom-setup/
        // Ensure context & request isolation are correctly managed
        contextManager: new Sentry.SentryContextManager()
    });

    sdk.start();
}

