const { LENIENT_SEARCH_HANDLING } = require('../../constants');
/**
 * combines args with args from request
 * @param {import('http').IncomingMessage} req
 * @param {Object} args
 * @returns {Object} array of combined arguments
 */
module.exports.get_all_args = (req, args) => {
    // our query processor hides certain query parameters from us so we need to get them from the context
    // Handling specifies the type of search to be conducted strict or lenient
    // https://www.hl7.org/fhir/search.html#errors
    if (args) {
        args.handling = req.headers.handling ? req.headers.handling : LENIENT_SEARCH_HANDLING;
    }
    return Object.assign({}, args, req.sanitized_args ?? {}, req.query);
};
