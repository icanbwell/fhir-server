/**
 * Unit tests for escapeForJsonTemplate (DCON-4808).
 *
 * $everything's customQuery templates (see everythingRelatedResourcesMapper.js) substitute
 * `{placeholder}` markers -- sourced from parent Patient/Person resource fields such as
 * `_sourceId`/`_sourceAssigningAuthority` -- directly into a JSON-template string, then call
 * JSON.parse() on the result. Those fields are attacker-influenceable at an earlier
 * create/merge (second-order injection): a value containing `"` or `}` could break out of
 * the JSON string literal and inject arbitrary query structure/operators. This is the fix.
 */
const { describe, test, expect, jest } = require('@jest/globals');

jest.mock('../../../../config', () => ({}));
jest.mock('../../../../utils/mongoDatabaseManager', () => ({}));
jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../../../operations/common/logging', () => ({
    logInfo: jest.fn(),
    logDebug: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn()
}));
jest.mock('../../../../utils/metrics', () => ({ recordOutboundEverything: jest.fn() }));
jest.mock('../../../../utils/assertType', () => ({
    assertTypeEquals: jest.fn(),
    assertIsValid: jest.fn()
}));

const { escapeForJsonTemplate } = require('../../../../operations/everything/everythingHelper');

describe('escapeForJsonTemplate', () => {
    test('leaves a plain alphanumeric value unchanged', () => {
        expect(escapeForJsonTemplate('patient-uuid-123')).toBe('patient-uuid-123');
    });

    test('escapes a double quote so it cannot close the surrounding JSON string', () => {
        expect(escapeForJsonTemplate('abc"def')).toBe('abc\\"def');
    });

    test('escapes a backslash', () => {
        expect(escapeForJsonTemplate('a\\b')).toBe('a\\\\b');
    });

    test('coerces a non-string value to string first', () => {
        expect(escapeForJsonTemplate(12345)).toBe('12345');
    });

    // The actual attack: a template substitution + JSON.parse, exactly as
    // everythingHelper.js does it, with a malicious _sourceId-style value.
    test('defuses an injection attempt that would otherwise break out of the JSON string', () => {
        const template = '{"collection.source._uuid":"{resourceType}/{_uuid}"}';
        // Without escaping, this closes the string+key early and injects a second key --
        // crafted so the template's fixed trailing `"}` completes valid (but attacker-
        // controlled) JSON.
        const maliciousUuid = 'x","injected":"true';

        const injectedUnsafely = template
            .replace('{resourceType}', 'Patient')
            .replace('{_uuid}', maliciousUuid);
        const parsedUnsafely = JSON.parse(injectedUnsafely);
        // Confirm the premise: the unescaped path really does let the attacker inject a
        // second, unrelated key into the query object.
        expect(Object.keys(parsedUnsafely)).toContain('injected');

        const safe = template
            .replace('{resourceType}', escapeForJsonTemplate('Patient'))
            .replace('{_uuid}', escapeForJsonTemplate(maliciousUuid));
        const parsedSafely = JSON.parse(safe);

        // The malicious value must survive only as an inert string value -- one key,
        // no injected structure.
        expect(parsedSafely).toEqual({
            'collection.source._uuid': `Patient/${maliciousUuid}`
        });
        expect(Object.keys(parsedSafely)).toEqual(['collection.source._uuid']);
    });
});
