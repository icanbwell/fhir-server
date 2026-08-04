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

/**
 * Recursively removes any `_file_id` field from an object, including nested objects and
 * arrays of objects. `_file_id` is only ever meant to be set by DatabaseAttachmentManager
 * itself (after it actually uploads `data` to GridFS) -- a client submitting `_file_id`
 * directly, with no `data`, would otherwise have that value persisted verbatim and later
 * used to serve back whatever GridFS content that id happens to point to, regardless of
 * whether the client uploaded or owns it. Callers should apply this to the incoming
 * request payload only, before it's merged with the current stored resource, so a
 * legitimate `_file_id` already on the stored resource is never affected.
 *
 * @param {Object} obj
 */
function removeFileIdFieldRecursive(obj) {
    if (!obj || typeof obj !== 'object') {
        return;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            removeFileIdFieldRecursive(item);
        }
        return;
    }

    for (const key of Object.keys(obj)) {
        if (key === '_file_id') {
            delete obj[key];
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            removeFileIdFieldRecursive(obj[key]);
        }
    }
}

module.exports = { removeUnderscoreFieldsRecursive, removeFileIdFieldRecursive };
