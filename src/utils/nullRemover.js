/**
 * This function removes any null, undefined, empty objects and empty arrays
 * @param {Object} obj
 * @return {Object}
 */
const removeNull = (obj) => {
    if (!obj || (typeof obj !== 'object')) {
        return obj;
    }
    Object.keys(obj).forEach(key => {
            // Get this value and its type
            const value = obj[`${key}`];
            if (value === null) {
                delete obj[`${key}`];
                return;
            }
            const type = typeof value;
            // Date is also of type Object but has no properties
            if (type === 'object' && !(value instanceof Date)) {
                // Recurse...
                removeNull(value);
                if (Array.isArray(value)) {
                    for (const arrayItem of value) {
                        removeNull(arrayItem);
                    }
                    for (let i=value.length-1; i>=0; i--) {
                        if (typeof value[i] === 'object' && Object.entries(value[i]).length === 0) {
                            value.splice(i, 1);
                        }
                    }
                }
            } else if (type === 'undefined') {
                delete obj[`${key}`];
            }
        }
    );
    return obj;
};

module.exports = {
    removeNull
};
