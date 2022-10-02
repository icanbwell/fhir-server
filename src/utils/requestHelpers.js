const accepts = require('accepts');
/**
 * These mime types are considered json by FHIR spec
 * https://www.hl7.org/fhir/http.html#parameters
 * @type {string[]}
 */
const jsonMimeTypes = ['application/fhir+json', 'application/json', 'json'];

/**
 * returns whether the query string has a _format parameter that indicates json
 * @param query
 * @returns {boolean}
 */
function hasJsonMimeTypeInFormatQuery({query}) {
    const urlParams = new URLSearchParams(query);
    return !urlParams.has('_format') || !jsonMimeTypes.includes(urlParams.get('_format'));
}

/**
 * returns whether the request accepts header has a mime type that indicates json
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function hasJsonMimeTypeInAcceptsHeader({req}) {
    // https://www.npmjs.com/package/accepts
    const acceptHeader = accepts(req);
    return acceptHeader.type(jsonMimeTypes) === false ? false : true;
}

/**
 * Returns whether the request should return HTML
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
const shouldReturnHtml = (req) => {
    return (
        (req.accepts('text/html') && !hasJsonMimeTypeInAcceptsHeader({req})) && // if the request is for HTML
        (req.method === 'GET' || req.method === 'POST') && // and this is a GET or a POST
        !hasJsonMimeTypeInFormatQuery(req.query) &&
        (req.useragent && req.useragent.isDesktop) // Postman sends */* so we need this to avoid sending html to Postman
    );
};

module.exports = {
    shouldReturnHtml
};
