'use strict';

const opentelemetry = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
const { Resource } = require('@opentelemetry/resources');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

// Instrumentations
const { DataloaderInstrumentation } = require('@opentelemetry/instrumentation-dataloader');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { FsInstrumentation } = require('@opentelemetry/instrumentation-fs');
const { GraphQLInstrumentation } = require('@opentelemetry/instrumentation-graphql');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { LruMemoizerInstrumentation } = require('@opentelemetry/instrumentation-lru-memoizer');
const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
const { RouterInstrumentation } = require('@opentelemetry/instrumentation-router');
const { WinstonInstrumentation } = require('@opentelemetry/instrumentation-winston');

const ignoreUrls = ['/health', '/live', '/ready'].concat(
    process.env.OPENTELEMETRY_IGNORE_URLS?.split(',')
);

const sdk = new opentelemetry.NodeSDK({
    resource: new Resource(),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [
        new DataloaderInstrumentation(),
        new ExpressInstrumentation(),
        new FsInstrumentation(),
        new GraphQLInstrumentation(),
        new HttpInstrumentation({
            ignoreIncomingRequestHook: (req) => ignoreUrls.includes(req.url),
        }),
        new LruMemoizerInstrumentation(),
        new MongoDBInstrumentation({
            enhancedDatabaseReporting: true,
        }),
        new RouterInstrumentation(),
        new WinstonInstrumentation(),
    ],
});

sdk.start();
