'use strict';

const { describe, test, expect } = require('@jest/globals');
const { ViewControlSubject, VIEW_CONTROL_SUBJECT_SOURCE } = require('../../../utils/viewControlSubject');

describe('ViewControlSubject', () => {
    test.each([
        ['a service token', { isUser: false, personIdFromJwtToken: 'person-1' }],
        ['a member token without a person id', { isUser: true }],
        ['no requestInfo', undefined]
    ])('fromToken returns null for %s', (_name, requestInfo) => {
        expect(ViewControlSubject.fromToken(requestInfo)).toBeNull();
    });

    test('fromToken takes the member\'s person id from the token', () => {
        const subject = ViewControlSubject.fromToken({ isUser: true, personIdFromJwtToken: 'person-1' });
        expect(subject.personId).toBe('person-1');
        expect(subject.source).toBe(VIEW_CONTROL_SUBJECT_SOURCE.TOKEN);
        expect(subject.isUrlPerson).toBe(false);
    });

    test('fromUrlPerson takes the Person id from the URL', () => {
        const subject = ViewControlSubject.fromUrlPerson({ personId: 'person-1' });
        expect(subject.personId).toBe('person-1');
        expect(subject.isUrlPerson).toBe(true);
    });

    test('equality is by value, and the same person from a different source is a different subject', () => {
        const a = ViewControlSubject.fromUrlPerson({ personId: 'person-1' });
        expect(a.equals(ViewControlSubject.fromUrlPerson({ personId: 'person-1' }))).toBe(true);
        expect(a.equals(ViewControlSubject.fromUrlPerson({ personId: 'person-2' }))).toBe(false);
        expect(a.equals(ViewControlSubject.fromToken({ isUser: true, personIdFromJwtToken: 'person-1' }))).toBe(false);
        expect(a.equals(null)).toBe(false);
        expect(String(a)).not.toEqual(String(ViewControlSubject.fromToken({ isUser: true, personIdFromJwtToken: 'person-1' })));
    });

    test('it is immutable', () => {
        const subject = ViewControlSubject.fromUrlPerson({ personId: 'person-1' });
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
