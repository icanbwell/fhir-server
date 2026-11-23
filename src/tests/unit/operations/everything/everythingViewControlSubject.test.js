'use strict';

const { describe, test, expect } = require('@jest/globals');
const {
    getEverythingViewControlSubject, parseApplyDataViewControl
} = require('../../../../operations/everything/everythingViewControlSubject');

const user = { isUser: true, personIdFromJwtToken: 'user-person' };
const service = { isUser: false };
const args = (optIn) => (optIn === undefined ? {} : { _applyDataViewControl: optIn });

describe('getEverythingViewControlSubject', () => {
    test.each([
        ['a user token, no opt-in', user, args(), true, ['p1'], { source: 'token', personId: 'user-person' }],
        ['a user token ignores the opt-in', user, args('true'), true, ['p1', 'p2'], { source: 'token', personId: 'user-person' }],
        ['a service token without the opt-in', service, args(), true, ['p1'], null],
        ['a service token with the opt-in set to false', service, args('false'), true, ['p1'], null],
        ['a service token without the opt-in on Patient $everything', service, args(), false, ['p1', 'p2'], null],
        ['a service token opting in on Person $everything', service, args('true'), true, ['p1'], { source: 'urlPerson', personId: 'p1' }],
        ['the opt-in accepts 1 as true', service, args('1'), true, ['p1'], { source: 'urlPerson', personId: 'p1' }]
    ])('%s', (_name, requestInfo, parsedArgs, isPersonEverything, personIds, expected) => {
        const subject = getEverythingViewControlSubject({
            parsedArgs, requestInfo, isPersonEverything, personIds, method: 'GET'
        });
        if (expected === null) {
            expect(subject).toBeNull();
        } else {
            expect({ source: subject.source, personId: subject.personId }).toEqual(expected);
        }
    });

    test.each([
        ['on Patient $everything', false, ['p1'], 'GET', 'only supported on Person $everything'],
        ['on a Person $everything DELETE', true, ['p1'], 'DELETE', 'only supported on Person $everything'],
        ['with more than one Person id', true, ['p1', 'p2'], 'GET', 'one Person per request'],
        ['with no Person id', true, [], 'GET', 'one Person per request']
    ])('a service token opting in %s is a 400', (_name, isPersonEverything, personIds, method, message) => {
        expect(() => getEverythingViewControlSubject({
            parsedArgs: args('true'), requestInfo: service, isPersonEverything, personIds, method
        })).toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringContaining(message) }));
    });
});

describe('a malformed opt-in value', () => {
    test.each([['yes'], ['on'], [''], [['true', 'true']], [2]])('%p is a 400 for a service token', (value) => {
        expect(() => getEverythingViewControlSubject({
            parsedArgs: args(value), requestInfo: service, isPersonEverything: true, personIds: ['p1'], method: 'GET'
        })).toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    test('is a 400 for a user token too', () => {
        expect(() => getEverythingViewControlSubject({
            parsedArgs: args('yes'), requestInfo: user, isPersonEverything: true, personIds: ['p1'], method: 'GET'
        })).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
});

describe('parseApplyDataViewControl', () => {
    test.each([
        [undefined, false], [null, false],
        ['true', true], ['TRUE', true], ['1', true], [true, true],
        ['false', false], ['False', false], ['0', false], [false, false]
    ])('%p is %p', (value, expected) => {
        expect(parseApplyDataViewControl(value)).toBe(expected);
    });
});
