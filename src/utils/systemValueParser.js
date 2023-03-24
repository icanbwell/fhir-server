class SystemValueParser {
    /**
     * Parses system/value string
     * The id can be '123|medstar' or '123'
     * @param {string} text
     * @return {{ system: string|undefined, value: string}}
     */
    static parse(text) {
        let system;
        let value;

        const idParts = text.split('|');
        if (idParts.length > 1) {
            system = idParts[0];
            value = idParts[1];
        } else {
            value = text;
        }

        return {system, value};
    }

}

module.exports = {
    SystemValueParser
};
