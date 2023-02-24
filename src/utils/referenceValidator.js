/**
 * This file implement calling the FHIR validator
 */

/**
 * Validate if the provided reference object is valid or not
 * @param {Object} referenceObj
 * @param {string} path
 * @returns {string | null}
 */
function checkReferenceValue(referenceObj, path) {
    const reference = referenceObj.reference;
    if (!reference) {
        return;
    }
    const isContainedReference = referenceValue => referenceValue[0] === '#';
    // eslint-disable-next-line security/detect-unsafe-regex
    const absoluteUrlRegex = new RegExp('^(?:[a-z+]+:)?//', 'i');
    const isAbsoluteUrl = referenceValue => absoluteUrlRegex.test(referenceValue);
    const isRelativeUrl = referenceValue => referenceValue.split('/').length - 1 === 1;
    if (!(isContainedReference(reference) || isAbsoluteUrl(reference) || isRelativeUrl(reference))) {
        return `${path}.reference: ${reference} is an invalid reference`;
    }
}

/**
 * Validate if the references in a resource object/array are valid or not
 * @param {Object} resourceObj
 * @param {string} path
 * @returns {*[]}
 */
function validateReferences(resourceObj, path) {
    if (!resourceObj) {
        return [];
    }
    let errors = [];
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
            },
        );

    } else {
        for (let prop in resourceObj) {
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

module.exports = { validateReferences };
