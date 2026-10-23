/**
 * This file implement calling the FHIR validator
 */

const { REGEX } = require("../constants");
const fieldTypes = require('../fhir/fhir-generated.field-types.json');

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

const URI_REFERENCE_ELEMENTS = new Set(
    Object.entries(fieldTypes)
        .filter(([key, value]) => key.endsWith('.reference') && value.code === 'uri')
        .map(([key]) => key.slice(0, -'.reference'.length))
);

/**
 * Validate if the references in a resource object/array are valid or not
 * uri elements that happen to be named reference (Immunization.education.reference,
 * DetectedIssue.reference) are not References and are skipped
 * @param {Object} resourceObj
 * @param {string} path
 * @param {string} [elementName]
 * @returns {*[]}
 */
function fastValidateReferences (resourceObj, path, elementName = resourceObj?.resourceType) {
    const errors = [];
    if (!resourceObj || typeof resourceObj !== 'object') {
        return errors;
    }

    const entries = Object.entries(resourceObj);
    for (const [key, value] of entries) {
        if (typeof value === 'object' && value !== null) {
            const newPath = path ? `${path}.${key}` : `${key}`;
            const valueName = value.resourceType || (Array.isArray(resourceObj) ? elementName : `${elementName}.${key}`);
            if (
                Object.prototype.hasOwnProperty.call(value, 'reference') &&
                typeof value.reference === 'string' &&
                !URI_REFERENCE_ELEMENTS.has(valueName)
            ) {
                const err = checkReferenceValue(value, newPath);
                if (err) {
                    errors.push(err);
                }
            }
            const objErrors = fastValidateReferences(value, newPath, valueName);
            errors.push(...objErrors);
        }
    }

    return errors;
}

module.exports = { validateReferences, fastValidateReferences };
