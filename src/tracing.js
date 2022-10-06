/**
 * Implements tracing to send metrics to Datadog.
 */
// Require dependencies
const openTelemetry = require('@opentelemetry/sdk-node');
// noinspection SpellCheckingInspection
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { CollectorTraceExporter } = require('@opentelemetry/exporter-collector');
const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
// const { PrometheusExporter } = require("@openTelemetry/exporter-prometheus");

const collectorOptions = {};

const traceExporter = new CollectorTraceExporter(collectorOptions);

// const prometheusExporter = new PrometheusExporter({ startServer: true });

// noinspection SpellCheckingInspection
const sdk = new openTelemetry.NodeSDK({
    traceExporter,
    // metricExporter: prometheusExporter(),
    instrumentations: [
        getNodeAutoInstrumentations(),
        new MongoDBInstrumentation({
            // see under for available configuration
        }),
        // Express instrumentation expects HTTP layer to be instrumented
        new HttpInstrumentation(),
    ],
});

sdk.start()
    .then(() => console.log(JSON.stringify({ message: 'Tracing initialized' })))
    .catch((error) =>
        console.log(JSON.stringify({ message: 'Error initializing tracing', error }))
    );

process.on('SIGTERM', () => {
    sdk.shutdown()
        .then(() => console.log(JSON.stringify({ message: 'Tracing terminated' })))
        .catch((error) =>
            console.log(JSON.stringify({ message: 'Error terminating tracing', error }))
        )
        .finally(() => process.exit(0));
});
