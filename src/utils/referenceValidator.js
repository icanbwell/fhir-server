/**
 * This file implement calling the FHIR validator
 */

const { REGEX } = require("../constants");

/**
 * Validate if the provided reference object is valid or not
 * @param {Object} referenceObj
 * @param {string} path
 * @returns {string | null}
 */
function checkReferenceValue (referenceObj, path) {
    const reference = referenceObj.reference;
    if (!reference) {
        return null;
    }
    const isContainedReference = referenceValue => referenceValue[0] === '#';
    const isAbsoluteUrl = referenceValue => REGEX.ABSOLUTE_URL.test(referenceValue);
    const isRelativeUrl = referenceValue => referenceValue.split('/').length - 1 === 1;
    if (!(isContainedReference(reference) || isAbsoluteUrl(reference) || isRelativeUrl(reference))) {
        return `${path}.reference: ${reference} is an invalid reference`;
    }
}

/**
 * Validate if the references in a resource object/array are valid or not
 * @param {Resource} resourceObj
 * @param {string} path
 * @returns {*[]}
 */
function validateReferences (resourceObj, path) {
    if (!resourceObj) {
        return [];
    }
    const errors = [];
    if (resourceObj.constructor.name === 'Reference') {
        const err = checkReferenceValue(resourceObj, path);
        if (err) {
            errors.push(err);
        }
    } else if (Array.isArray(resourceObj)) {
        resourceObj.forEach(
            (arrObj, i) => {
                if (typeof arrObj === 'object' && arrObj) {
                    const newPath = path ? `${path}.${i}` : `${i}`;
                    const objErrors = validateReferences(arrObj, newPath);
                    errors.push(...objErrors);
                }
            }
        );
    } else {
        for (const prop in resourceObj) {
            if (
                Object.prototype.hasOwnProperty.call(resourceObj, prop) &&
                resourceObj[`${prop}`] && typeof resourceObj[`${prop}`] === 'object'
            ) {
                const newPath = path ? `${path}.${prop}` : `${prop}`;
                const objErrors = validateReferences(resourceObj[`${prop}`], newPath);
                errors.push(...objErrors);
            }
        }
    }
    return errors;
}


/**
 * Validate if the references in a resource object/array are valid or not
 * @param {Object} resourceObj
 * @param {string} path
 * @returns {*[]}
 */
function fastValidateReferences (resourceObj, path) {
    // mergeTodo - test
    const errors = [];
    if (!resourceObj || typeof resourceObj !== 'object') {
        return errors;
    }

    const entries = Object.entries(resourceObj);
    for (const [key, value] of entries) {
        if (typeof value === 'object' && value !== null) {
            if (Object.prototype.hasOwnProperty.call(value, 'reference') && typeof value.reference === 'string') {
                const err = checkReferenceValue(value, path);
                if (err) {
                    errors.push(err);
                }
            } else {
                const newPath = path ? `${path}.${key}` : `${key}`;
                const objErrors = fastValidateReferences(value, newPath);
                errors.push(...objErrors);
            }
        }
    }

    return errors;
}

module.exports = { validateReferences, fastValidateReferences };
