/**
 * This route handler sets the headers for content security policy
 */

const env = require('var');
const httpContext = require('express-http-context');
const { RESPONSE_NONCE } = require('../constants');

module.exports.handleSecurityPolicy = function (req, res, next) {
    // get the nonce id for current request
    const nonce = httpContext.get(RESPONSE_NONCE);

    if (!res.headersSent) {
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self' embeddable-sandbox.cdn.apollographql.com apollo-server-landing-page.cdn.apollographql.com; " +
            "object-src data: 'unsafe-eval'; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' 'unsafe-inline' 'unsafe-hashes' 'unsafe-eval' data: http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "script-src 'self' " + `'nonce-${nonce}' ` + 'https://ajax.googleapis.com/ https://cdnjs.cloudflare.com http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com ' + env.AUTH_CODE_FLOW_URL + ';' +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com/ http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "frame-src 'self' https://embeddable-sandbox.cdn.apollographql.com https://sandbox.embed.apollographql.com/; " +
            "connect-src 'self' " + env.AUTH_CODE_FLOW_URL + '/oauth2/token;' +
            "form-action 'self' https://embeddable-sandbox.cdn.apollographql.com https://sandbox.embed.apollographql.com/  https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "frame-ancestors 'self' https://embeddable-sandbox.cdn.apollographql.com https://sandbox.embed.apollographql.com/  https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';'
        );
    }
    next();
};

module.exports.handleSecurityPolicyGraphql = function (req, res, next) {
    if (!res.headersSent) {
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self' embeddable-sandbox.cdn.apollographql.com apollo-server-landing-page.cdn.apollographql.com; " +
            "object-src data: 'unsafe-eval'; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' 'unsafe-inline' 'unsafe-hashes' 'unsafe-eval' data: http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "script-src 'self' " + "'unsafe-inline' " + 'https://ajax.googleapis.com/ https://cdnjs.cloudflare.com http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com ' + env.AUTH_CODE_FLOW_URL + ';' +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com/ http://cdn.jsdelivr.net https://embeddable-sandbox.cdn.apollographql.com https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "frame-src 'self' https://embeddable-sandbox.cdn.apollographql.com https://sandbox.embed.apollographql.com/; connect-src 'self' " + env.AUTH_CODE_FLOW_URL + '/oauth2/token;' +
            "form-action 'self' https://embeddable-sandbox.cdn.apollographql.com https://sandbox.embed.apollographql.com/  https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';' +
            "frame-ancestors 'self' https://embeddable-sandbox.cdn.apollographql.com https://sandbox.embed.apollographql.com/  https://apollo-server-landing-page.cdn.apollographql.com " + env.AUTH_CODE_FLOW_URL + ';'
        );
    }
    next();
};

