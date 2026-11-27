const CONTINUATION_BYTE_MASK = 0xc0;
const CONTINUATION_BYTE_PATTERN = 0x80;
// a UTF-8 character has at most 3 continuation bytes, so a cut never needs to move back further
const MAX_CONTINUATION_BYTES = 3;

/**
 * Decodes at most maxBytes of a UTF-8 buffer without cutting a multi-byte character in half, which
 * would otherwise decode to U+FFFD. The cut moves back to the start of the character it falls in,
 * so the result is at most 3 bytes shorter than maxBytes, even for invalid input.
 * @param {Buffer} buffer
 * @param {number} maxBytes
 * @returns {{text: string, truncated: boolean}}
 */
function truncateUtf8 (buffer, maxBytes) {
    if (buffer.length <= maxBytes) {
        return { text: buffer.toString('utf8'), truncated: false };
    }
    let end = maxBytes;
    // the first dropped byte being a continuation byte means the cut is inside a character
    for (
        let steps = 0;
        steps < MAX_CONTINUATION_BYTES && end > 0 &&
            (buffer[end] & CONTINUATION_BYTE_MASK) === CONTINUATION_BYTE_PATTERN;
        steps++
    ) {
        end--;
    }
    return { text: buffer.toString('utf8', 0, end), truncated: true };
}

module.exports = {
    truncateUtf8
};
