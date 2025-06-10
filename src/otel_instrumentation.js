'use strict';

const opentelemetry = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
const { defaultResource } = require('@opentelemetry/resources');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

// Instrumentations
const { DataloaderInstrumentation } = require('@opentelemetry/instrumentation-dataloader');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { GraphQLInstrumentation } = require('@opentelemetry/instrumentation-graphql');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { LruMemoizerInstrumentation } = require('@opentelemetry/instrumentation-lru-memoizer');
const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
const { RouterInstrumentation } = require('@opentelemetry/instrumentation-router');
const { WinstonInstrumentation } = require('@opentelemetry/instrumentation-winston');

let ignoreUrls = ['/health', '/live', '/ready'];
if (process.env.OPENTELEMETRY_IGNORE_URLS) {
    ignoreUrls = ignoreUrls.concat(
        process.env.OPENTELEMETRY_IGNORE_URLS?.split(',')
    );
}

const sdk = new opentelemetry.NodeSDK({
    resource: defaultResource(),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter()
    }),
    instrumentations: [
        new DataloaderInstrumentation(),
        new ExpressInstrumentation(),
        new GraphQLInstrumentation(),
        new HttpInstrumentation({
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
        }),
        new LruMemoizerInstrumentation(),
        new MongoDBInstrumentation({
            enhancedDatabaseReporting: true,
            responseHook: (span) => {
                if (
                    span.attributes['db.system'] === 'mongodb' &&
                    !['find', 'aggregate'].includes(span.attributes['db.operation'])
                ) {
                    delete span.attributes['db.statement'];
                }
            }
        }),
        new RouterInstrumentation(),
        new WinstonInstrumentation()
    ]
});

sdk.start();
