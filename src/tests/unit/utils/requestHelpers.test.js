'use strict';

const { describe, test, expect } = require('@jest/globals');
const { shouldReturnHtml, shouldStreamResponse } = require('../../../utils/requestHelpers');

describe('requestHelpers', () => {
    const makeReq = (overrides = {}) => ({
        method: 'GET',
        accepts: (type) => type === 'text/html',
        useragent: { isDesktop: true },
        params: {},
        ...overrides
    });

    describe('shouldReturnHtml', () => {
        test('returns true for GET from desktop browser accepting HTML', () => {
            expect(shouldReturnHtml(makeReq())).toBe(true);
        });

        test('returns true for POST from desktop browser accepting HTML', () => {
            expect(shouldReturnHtml(makeReq({ method: 'POST' }))).toBe(true);
        });

        test('returns false for PUT method', () => {
            expect(shouldReturnHtml(makeReq({ method: 'PUT' }))).toBe(false);
        });

        test('returns false for DELETE method', () => {
            expect(shouldReturnHtml(makeReq({ method: 'DELETE' }))).toBe(false);
        });

        test('returns false when not accepting HTML', () => {
            expect(shouldReturnHtml(makeReq({ accepts: () => false }))).toBe(false);
        });

        test('returns false for non-desktop user agent', () => {
            expect(shouldReturnHtml(makeReq({ useragent: { isDesktop: false } }))).toBe(false);
        });

        test('returns falsy when useragent is null (e.g. Postman)', () => {
            expect(shouldReturnHtml(makeReq({ useragent: null }))).toBeFalsy();
        });
    });

    describe('shouldStreamResponse', () => {
        test('returns true for non-HTML, non-question request', () => {
            const req = makeReq({ accepts: () => false });
            expect(shouldStreamResponse(req)).toBe(true);
        });

        test('returns false when shouldReturnHtml is true', () => {
            expect(shouldStreamResponse(makeReq())).toBe(false);
        });

        test('returns false when _question param is present', () => {
            const req = makeReq({
                accepts: () => false,
                params: { _question: 'search' }
            });
            expect(shouldStreamResponse(req)).toBe(false);
        });

        test('returns true when _question is undefined', () => {
            const req = makeReq({
                accepts: () => false,
                params: { _question: undefined }
            });
            expect(shouldStreamResponse(req)).toBe(true);
        });
    });
});
