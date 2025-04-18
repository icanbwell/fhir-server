class NestedPropertyReader {
    /**
     * Get nested property from object
     * @param {Object} obj
     * @param {string} path
     * @returns {undefined|*}
     */
    static getNestedProperty ({ obj, path }) {
        if (!path || !obj) {
            return undefined;
        }
        const properties = path.split('.');
        if(!Array.isArray(obj)) {
            if (properties.length === 1) {return obj[properties[0]]}
            // noinspection TailRecursionJS
            return NestedPropertyReader.getNestedProperty({ obj: obj[properties[0]], path: path.replace(`${properties[0]}.`, '') })
        } else {
            const result = [];
            for (let item of obj) {
                const value = NestedPropertyReader.getNestedProperty({ obj: item, path });
                if (value) {
                    if (Array.isArray(value)) {
                        result.push(...value)
                    } else {
                        result.push(value);
                    }
                }
            }
            return result.length > 0 ? result : undefined;
        }
    }
}

module.exports = {
    NestedPropertyReader
};
