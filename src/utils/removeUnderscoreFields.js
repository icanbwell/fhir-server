/**
 * Recursively removes all fields starting with '_' from an object,
 * including nested objects and arrays of objects.
 *
 * @param {Object} obj
 */
function removeUnderscoreFieldsRecursive(obj) {
    if (!obj || typeof obj !== 'object') {
        return;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            removeUnderscoreFieldsRecursive(item);
        }
        return;
    }

    for (const key of Object.keys(obj)) {
        if (key.startsWith('_')) {
            delete obj[key];
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            removeUnderscoreFieldsRecursive(obj[key]);
        }
    }
}

module.exports = { removeUnderscoreFieldsRecursive };
