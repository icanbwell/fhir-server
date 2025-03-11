/**
 * This function updated references of given resource by using provided function.
 * @param {object} obj
 * @param {function} updateReferenceFn
 * @returns {Promise<object>} The updated object
 */
async function rawResourceReferenceUpdater(obj, updateReferenceFn) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }

    const entries = Object.entries(obj);
    for (const [key, value] of entries) {
        if (typeof value === 'object' && value !== null) {
            if (Object.prototype.hasOwnProperty.call(value, 'reference')) {
                obj[key] = await updateReferenceFn(value);
            } else {
                obj[key] = await rawResourceReferenceUpdater(value, updateReferenceFn);
            }
        }
    }

    return obj;
}

module.exports = {
    rawResourceReferenceUpdater
};
