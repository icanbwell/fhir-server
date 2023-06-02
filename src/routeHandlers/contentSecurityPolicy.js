/**
 * This route handler sets the headers for content security policy
 */

const env = require('var');
module.exports.handleSecurityPolicy = function (req, res, next) {
    if (!res.headersSent) {
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self' https://apollo-server-landing-page.cdn.apollographql.com; " +
            "object-src data: 'unsafe-eval'; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' 'unsafe-inline' 'unsafe-hashes' 'unsafe-eval' data: http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "script-src 'self' 'unsafe-inline' https://ajax.googleapis.com/ https://cdnjs.cloudflare.com http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com/ http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "frame-src 'self' https://embeddable-sandbox.cdn.apollographql.com https://sandbox.embed.apollographql.com/; connect-src 'self' " + env.AUTH_CODE_FLOW_URL + '/oauth2/token;'
        );
    }
    next();
};
