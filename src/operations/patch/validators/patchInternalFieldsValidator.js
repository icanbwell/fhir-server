const { BadRequestError } = require('../../../utils/httpErrors');

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isInternalField (segment) {
    return segment.startsWith('_');
}

/**
 * Checks if a JSON Patch path contains a segment targeting an internal field.
 * Internal fields start with _ and are used for authorization/tenant isolation.
 * @param {string} path
 * @returns {string|null} The offending field name, or null if path is clean
 */
function findInternalFieldInPath (path) {
    const segments = path.split('/');
    for (const segment of segments) {
        if (isInternalField(segment)) {
            return segment;
        }
    }
    return null;
}

/**
 * Recursively checks if an object value contains internal field keys.
 * This catches cases like: { op: "replace", path: "/link/0/target", value: { reference: "...", _uuid: "..." } }
 * @param {*} value
 * @returns {string|null} The offending field name, or null if value is clean
 */
function findInternalFieldInValue (value) {
    if (value === null || value === undefined || typeof value !== 'object') {
        return null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findInternalFieldInValue(item);
            if (found) {
                return found;
            }
        }
        return null;
    }
    for (const key of Object.keys(value)) {
        if (isInternalField(key)) {
            return key;
        }
        const found = findInternalFieldInValue(value[key]);
        if (found) {
            return found;
        }
    }
    return null;
}

/**
 * Validates that no patch operation targets internal fields.
 * Throws BadRequestError if any operation's path or value contains internal fields.
 * @param {Object[]} patchContent - Array of JSON Patch operations
 */
function validatePatchDoesNotTargetInternalFields(patchContent) {
    if (!Array.isArray(patchContent)) {
        return;
    }
    for (const operation of patchContent) {
        const fieldInPath = findInternalFieldInPath(operation.path || '');
        if (fieldInPath) {
            throw new BadRequestError(
                new Error(
                    `Patch operation targeting internal field '${fieldInPath}' is not allowed. ` +
                        'Internal fields prefixed with _ cannot be modified via PATCH.'
                )
            );
        }

        if (operation.value !== undefined) {
            const fieldInValue = findInternalFieldInValue(operation.value);
            if (fieldInValue) {
                throw new BadRequestError(
                    new Error(
                        `Patch operation contains internal field '${fieldInValue}' in value. ` +
                            'Internal fields prefixed with _ cannot be set via PATCH.'
                    )
                );
            }
        }
    }
}

module.exports = {
    validatePatchDoesNotTargetInternalFields,
    findInternalFieldInPath,
    findInternalFieldInValue
};
