class UrlParser {
    /**
     * returns whether this value is a url
     * @param queryParameterValue
     * @return {boolean}
     */
    static isUrl(queryParameterValue) {
        return typeof queryParameterValue === 'string' &&
            (
                queryParameterValue.startsWith('http://') ||
                queryParameterValue.startsWith('https://') ||
                queryParameterValue.startsWith('ftp://')
            );
    }
}

module.exports = {
    UrlParser
};
