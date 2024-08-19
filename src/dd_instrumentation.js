console.log('Initializing Datadog APM SDK');

require('dd-trace').init({
    logInjection: true
});
