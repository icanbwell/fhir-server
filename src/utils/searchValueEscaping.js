/**
 * Escape-aware splitting/unescaping for FHIR search values, per
 * https://hl7.org/fhir/R4B/search.html#escaping — ',', '|', '$', and '\' are separator/escape
 * characters; a literal occurrence of the first three must be backslash-escaped by the caller,
 * and a literal '\' must be escaped as '\\'.
 *
 * A search value can pass through more than one delimiter-splitting stage before reaching a
 * leaf use (e.g. a composite component: split on '$', then handed to a token filter that splits
 * on '|'). splitUnescaped() never unescapes -- doing so early would destroy an escape marker a
 * later stage still needs. Only unescapeSearchValue() actually converts escape sequences to
 * literal characters, and it must be called exactly once, at the true leaf (the point where a
 * string is about to become a literal Mongo match/regex value, with no further delimiter
 * splitting ahead of it).
 */

const ESCAPABLE_CHARS = new Set(['$', ',', '|', '\\']);

/**
 * Splits `value` on every occurrence of `delimiter` that is not escaped -- a delimiter is
 * escaped if it's preceded by an odd number of consecutive backslashes. Backslash sequences are
 * left untouched in the returned parts (no unescaping here).
 * @param {string} value
 * @param {string} delimiter a single character
 * @return {string[]}
 */
function splitUnescaped (value, delimiter) {
    if (typeof value !== 'string') {
        return [value];
    }
    const parts = [];
    let current = '';
    let backslashRun = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\') {
            backslashRun++;
            current += ch;
            continue;
        }
        if (ch === delimiter && backslashRun % 2 === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
        backslashRun = 0;
    }
    parts.push(current);
    return parts;
}

/**
 * Converts '\$', '\,', '\|', '\\' to their literal characters. A lone trailing backslash, or a
 * backslash followed by a character that isn't one of the four escapable characters, is passed
 * through literally rather than treated as an error -- rejecting it risks breaking a free-text
 * value that happens to contain a backslash for unrelated reasons.
 * @param {string} value
 * @return {string}
 */
function unescapeSearchValue (value) {
    if (typeof value !== 'string') {
        return value;
    }
    let result = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\' && i + 1 < value.length && ESCAPABLE_CHARS.has(value[i + 1])) {
            result += value[i + 1];
            i++;
        } else {
            result += ch;
        }
    }
    return result;
}

module.exports = {
    splitUnescaped,
    unescapeSearchValue
};
