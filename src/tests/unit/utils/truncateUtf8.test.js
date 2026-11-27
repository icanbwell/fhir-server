const { describe, test, expect } = require('@jest/globals');
const { truncateUtf8 } = require('../../../utils/truncateUtf8');

describe('truncateUtf8', () => {
    // synthetic strings; every limit that cuts inside a multi-byte character must back off to the
    // start of that character instead of producing U+FFFD
    test.each([
        ['ascii, limit not reached', 'abc', 10, 'abc', false],
        ['ascii, exact fit', 'abc', 3, 'abc', false],
        ['ascii, truncated', 'abcdef', 3, 'abc', true],
        ['2-byte char kept whole', 'abñ', 4, 'abñ', false],
        ['cut inside 2-byte char', 'abñz', 3, 'ab', true],
        ['cut after 2-byte char', 'abñz', 4, 'abñ', true],
        ['cut inside 3-byte char, after 1 byte', 'ab€z', 3, 'ab', true],
        ['cut inside 3-byte char, after 2 bytes', 'ab€z', 4, 'ab', true],
        ['cut inside 4-byte char, after 3 bytes', 'ab😀z', 5, 'ab', true],
        ['limit smaller than first character', '😀', 2, '', true]
    ])('%s', (label, input, maxBytes, expectedText, expectedTruncated) => {
        const result = truncateUtf8(Buffer.from(input, 'utf8'), maxBytes);

        expect(result).toEqual({ text: expectedText, truncated: expectedTruncated });
        expect(result.text).not.toContain('�');
    });
});
