class NestedPropertyReader {
    /**
     * Get nested property from object
     * @param {Object} obj
     * @param {string} path
     * @returns {undefined|*}
     */
    static getNestedProperty ({obj, path}) {
        if (!path) {
            return undefined;
        }
        const properties = path.split('.');
        let value = obj;
        for (const property of properties) {
            value = value[`${property}`];
            if (value === undefined) {
                return undefined; // Return undefined if property is not found
            }
        }
        return value;
    }
}

module.exports = {
    NestedPropertyReader
};
