'use strict';

const { describe, test, expect } = require('@jest/globals');
const { IdentifierSystem } = require('../../../utils/identifierSystem');

describe('IdentifierSystem', () => {
    test('sourceId is icanbwell sourceId URL', () => {
        expect(IdentifierSystem.sourceId).toBe('https://www.icanbwell.com/sourceId');
    });

    test('uuid is icanbwell uuid URL', () => {
        expect(IdentifierSystem.uuid).toBe('https://www.icanbwell.com/uuid');
    });

    test('all values are HTTPS URLs', () => {
        Object.values(IdentifierSystem).forEach(url => {
            expect(url).toMatch(/^https:\/\//);
        });
    });
});
