/**
 * Returns whether the request should return HTML
 * @param req
 * @returns {boolean}
 */
const shouldReturnHtml = (req) => {
    return (
        (req.accepts('text/html') && (req.headers.accept && !req.headers.accept.includes('application/fhir+json'))) && // if the request is for HTML
        (req.method === 'GET' || req.method === 'POST') && // and this is a GET or a POST
        (req.useragent && req.useragent.isDesktop) // Postman sends */* so we need this to avoid sending html to Postman
    );
};

module.exports = {
    shouldReturnHtml
};
