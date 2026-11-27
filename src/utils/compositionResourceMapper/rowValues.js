/**
 * Reads the display strings the composition service writes into section rows.
 */

// Values the composition service writes when the source had nothing to show.
const PLACEHOLDERS = new Set([
    'unknown',
    'unknown allergen',
    'unknown allergy',
    'unknown condition',
    'unknown metric',
    'unknown observation',
    'unknown risk',
    'unknown substance',
    'unknown vaccine',
    'not specified',
    'not provided by source',
    'date not provided by source',
    'plan details not provided by source',
    'n/a',
    'none',
    'null'
]);

const DATE_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * @param {string} value
 * @returns {string}
 */
function unescapeHtml(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
    return value === '' || PLACEHOLDERS.has(value.toLowerCase());
}

/**
 * Lower-cases a display value into the shape of a FHIR code ("In Progress" -> "in-progress").
 * @param {string} value
 * @returns {string}
 */
function toCodeForm(value) {
    return value.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Returns a valid FHIR dateTime. A time without a timezone is not valid FHIR, so it is cut back
 * to its date instead of guessing a zone.
 * @param {string} value
 * @returns {string|undefined}
 */
function parseDateTime(value) {
    if (DATE_PATTERN.test(value)) {
        return value;
    }
    const match = DATE_TIME_PATTERN.exec(value);
    if (!match) {
        return undefined;
    }
    return match[3] ? value : match[1];
}

/**
 * Returns a valid FHIR instant, which always carries a time and a timezone.
 * @param {string} value
 * @returns {string|undefined}
 */
function parseInstant(value) {
    const match = DATE_TIME_PATTERN.exec(value);
    return match && match[3] ? value : undefined;
}

/**
 * @param {string} value
 * @returns {number|undefined}
 */
function parseDecimal(value) {
    return DECIMAL_PATTERN.test(value) ? Number(value) : undefined;
}

module.exports = {
    unescapeHtml,
    escapeHtml,
    isPlaceholder,
    toCodeForm,
    parseDateTime,
    parseInstant,
    parseDecimal
};
