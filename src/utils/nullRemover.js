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
                }
            } else if (type === 'undefined') {
                delete obj[`${key}`];
            }
        }
    );
    return obj;
};

const removeNullFromArray = (obj) => {
    if (!obj || (typeof obj !== 'object')) {
        return obj;
    }
    Object.keys(obj).forEach(key => {
        const value = obj[`${key}`];
        if (value === null) {
            return;
        }
        const type = typeof value;
        // Date is also of type Object but has no properties
        if (type === 'object' && !(value instanceof Date)) {
            // Recurse...
            removeNullFromArray(value);
            if (Array.isArray(value)) {
                for (const arrayItem of value) {
                    removeNullFromArray(arrayItem);
                }

                for (let i = value.length; i >= 0; i--) {
                    if (value[i] === null || (
                        typeof value[i] === 'object' &&
                        Object.keys(value[i]).length === 0
                    )) {
                        value.splice(i, 1);
                    }
                }
            }
        }
    });

    return obj;
}

module.exports = {
    removeNull,
    removeNullFromArray
};
