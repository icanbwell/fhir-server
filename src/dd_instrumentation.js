const tracer = require('dd-trace').init({
    logInjection: true
});

const ignoreUrls = ['/health', '/live', '/ready'].concat(
    process.env.OPENTELEMETRY_IGNORE_URLS?.split(',')
);

tracer.use('http', {
    server: {
        blocklist: ignoreUrls
    }
});
