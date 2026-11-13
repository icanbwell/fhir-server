/**
 * Row setters. Each one writes a cleaned row value onto the resource being built and returns
 * false when the value cannot be turned into that field, so the caller can report it.
 *
 * @typedef {(resource: Object, value: string, scratch: Object) => (boolean|void)} RowSetter
 */

const { parseDateTime, parseInstant, toCodeForm } = require('./rowValues');

/**
 * Writes a value at a path, creating the objects and arrays on the way.
 * @param {Object} target
 * @param {(string|number)[]} path
 * @param {*} value
 */
function setPath(target, path, value) {
    let node = target;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (node[key] === undefined) {
            node[key] = typeof path[i + 1] === 'number' ? [] : {};
        }
        node = node[key];
    }
    node[path[path.length - 1]] = value;
}

/**
 * @param {Object} target
 * @param {(string|number)[]} path
 * @returns {*}
 */
function getPath(target, path) {
    let node = target;
    for (const key of path) {
        if (node === undefined || node === null) {
            return undefined;
        }
        node = node[key];
    }
    return node;
}

/**
 * The row has no FHIR field on this resource. It still reaches the narrative.
 * @type {RowSetter}
 */
const narrativeOnly = () => true;

/**
 * @param {...(string|number)} path
 * @returns {RowSetter}
 */
const text =
    (...path) =>
    (resource, value) => {
        setPath(resource, path, value);
    };

/**
 * Like text, but keeps a value an earlier row already wrote.
 * @param {...(string|number)} path
 * @returns {RowSetter}
 */
const textIfAbsent =
    (...path) =>
    (resource, value) => {
        if (getPath(resource, path) === undefined) {
            setPath(resource, path, value);
        }
    };

/**
 * @param {...(string|number)} path
 * @returns {RowSetter}
 */
const dateTime =
    (...path) =>
    (resource, value) => {
        const parsed = parseDateTime(value);
        if (parsed === undefined) {
            return false;
        }
        setPath(resource, path, parsed);
    };

/**
 * @param {...(string|number)} path
 * @returns {RowSetter}
 */
const instant =
    (...path) =>
    (resource, value) => {
        const parsed = parseInstant(value);
        if (parsed === undefined) {
            return false;
        }
        setPath(resource, path, parsed);
    };

/**
 * A required-binding code field: only values in the value set are written.
 * @param {(string|number)[]} path
 * @param {string[]} allowed
 * @returns {RowSetter}
 */
const code = (path, allowed) => {
    const allowedSet = new Set(allowed);
    return (resource, value) => {
        const candidate = toCodeForm(value);
        if (!allowedSet.has(candidate)) {
            return false;
        }
        setPath(resource, path, candidate);
    };
};

/**
 * A CodeableConcept: the display always lands in text, and a coding is added when the display
 * is one this system defines.
 * @param {(string|number)[]} path
 * @param {string} system
 * @param {Object<string, string>} codesByDisplay keyed by the code form of the display
 * @returns {RowSetter}
 */
const codedConcept = (path, system, codesByDisplay) => (resource, value) => {
    const concept = { text: value };
    const matched = codesByDisplay[toCodeForm(value)];
    if (matched) {
        concept.coding = [{ system, code: matched }];
    }
    setPath(resource, path, concept);
};

/**
 * @param {...(string|number)} path
 * @returns {RowSetter}
 */
const bool =
    (...path) =>
    (resource, value) => {
        const candidate = value.toLowerCase();
        if (candidate === 'yes' || candidate === 'true') {
            setPath(resource, path, true);
        } else if (candidate === 'no' || candidate === 'false') {
            setPath(resource, path, false);
        } else {
            return false;
        }
    };

/**
 * Parks a value for the resource's finalize step, for fields built from more than one row.
 * @param {string} key
 * @returns {RowSetter}
 */
const stash = (key) => (_resource, value, scratch) => {
    scratch[key] = value;
};

/**
 * Builds a display-to-code table for systems whose codes are the code form of their displays.
 * @param {string[]} codes
 * @returns {Object<string, string>}
 */
function sameAsDisplay(codes) {
    return Object.fromEntries(codes.map((c) => [c, c]));
}

module.exports = {
    setPath,
    getPath,
    narrativeOnly,
    text,
    textIfAbsent,
    dateTime,
    instant,
    code,
    codedConcept,
    bool,
    stash,
    sameAsDisplay
};
