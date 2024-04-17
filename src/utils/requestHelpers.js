/**
 * Returns whether the request should return HTML
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
const shouldReturnHtml = (req) => {
    return (
        // Postman sends */* so we need this to avoid sending html to Postman
        (
            req.accepts('text/html') && // if the request is for HTML
            (req.method === 'GET' || req.method === 'POST') && // and this is a GET or a POST
            (req.useragent && req.useragent.isDesktop)
        )
    );
};

const shouldStreamResponse = (req) => {
    return (
        !shouldReturnHtml(req) && !(req.params._question)
    );
};

module.exports = {
    shouldReturnHtml,
    shouldStreamResponse
};
