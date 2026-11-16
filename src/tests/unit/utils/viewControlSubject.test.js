'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ViewControlSubject, VIEW_CONTROL_SUBJECT_SOURCE } = require('../../../utils/viewControlSubject');

describe('ViewControlSubject', () => {
    test.each([
        ['a service token', { isUser: false, personIdFromJwtToken: 'person-1' }],
        ['a user token without a person id', { isUser: true }],
        ['no requestInfo', undefined]
    ])('fromToken returns null for %s', (_name, requestInfo) => {
        expect(ViewControlSubject.fromToken(requestInfo)).toBeNull();
    });

    test('fromToken takes the user\'s person id from the token', () => {
        const subject = ViewControlSubject.fromToken({ isUser: true, personIdFromJwtToken: 'person-1' });
        expect(subject.personId).toBe('person-1');
        expect(subject.source).toBe(VIEW_CONTROL_SUBJECT_SOURCE.TOKEN);
    });

    test('identity (the lookup cache key) is by value', () => {
        const token = (personId) => ViewControlSubject.fromToken({ isUser: true, personIdFromJwtToken: personId });
        expect(String(token('person-1'))).toEqual(String(token('person-1')));
        expect(String(token('person-1'))).not.toEqual(String(token('person-2')));
    });

    test('it is immutable', () => {
        const subject = ViewControlSubject.fromToken({ isUser: true, personIdFromJwtToken: 'person-1' });
        expect(() => { subject.personId = 'person-2'; }).toThrow(TypeError);
        expect(subject.personId).toBe('person-1');
    });

    test.each([
        ['a missing person id', { source: VIEW_CONTROL_SUBJECT_SOURCE.TOKEN }],
        ['an unknown source', { personId: 'person-1', source: 'header' }]
    ])('rejects %s', (_name, params) => {
        expect(() => new ViewControlSubject(params)).toThrow();
    });
});
