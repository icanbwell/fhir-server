const contentType = require('content-type');

/**
 * @description Middleware for validating the content type if it matches the
 * allowedContentTypes
 * @param {List} allowedContentTypes - List of content types which are allowed.
 * @return {function} valid express middleware
 */
module.exports = function validateContentTypeMiddleware({ allowedContentTypes }) {
    return (req, res, next) => {
        const contentTypeHeader = contentType.parse(req.headers['content-type']);
        if (!allowedContentTypes.includes(contentTypeHeader.type)) {
            return res.status(400).json(
                {
                    message: `Content Type ${req.headers['content-type']} is not supported. ` +
                        `Allowed content-types are: ${allowedContentTypes.join(',')}`
                }
            );
        }
        next();
    };
}
