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
};

/**
 * Removes nulls from a GraphQL result like removeNullFromArray, but keeps `data._entities`
 * intact. A federation router matches `_entities` results to its representations by position,
 * so the list must have one item per representation, with null for any that did not resolve.
 * @param {Object} result
 * @return {Object}
 */
const removeNullFromGraphQLResult = (result) => {
    const entities = result?.data?._entities;
    if (!Array.isArray(entities)) {
        return removeNullFromArray(result);
    }
    result.data._entities = [];
    removeNullFromArray(result);
    // clean each entity on its own so the list itself keeps its length and order
    entities.forEach((entity) => removeNullFromArray(entity));
    result.data._entities = entities;
    return result;
};

module.exports = {
    removeNull,
    removeNullFromArray,
    removeNullFromGraphQLResult
};
