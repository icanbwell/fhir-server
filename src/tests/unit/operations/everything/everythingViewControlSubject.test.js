'use strict';

const { describe, test, expect } = require('@jest/globals');
const { getEverythingViewControlSubject } = require('../../../../operations/everything/everythingViewControlSubject');

const member = { isUser: true, personIdFromJwtToken: 'member-person' };
const service = { isUser: false };
const args = (optIn) => (optIn === undefined ? {} : { _applyDataViewControl: optIn });

describe('getEverythingViewControlSubject', () => {
    test.each([
        ['a member token, no opt-in', member, args(), true, ['p1'], { source: 'token', personId: 'member-person' }],
        ['a member token ignores the opt-in', member, args('true'), true, ['p1', 'p2'], { source: 'token', personId: 'member-person' }],
        ['a service token without the opt-in', service, args(), true, ['p1'], null],
        ['a service token with the opt-in set to false', service, args('false'), true, ['p1'], null],
        ['a service token without the opt-in on Patient $everything', service, args(), false, ['p1', 'p2'], null],
        ['a service token opting in on Person $everything', service, args('true'), true, ['p1'], { source: 'urlPerson', personId: 'p1' }],
        ['the opt-in accepts 1 as true', service, args('1'), true, ['p1'], { source: 'urlPerson', personId: 'p1' }]
    ])('%s', (_name, requestInfo, parsedArgs, isPersonEverything, personIds, expected) => {
        const subject = getEverythingViewControlSubject({ parsedArgs, requestInfo, isPersonEverything, personIds });
        if (expected === null) {
            expect(subject).toBeNull();
        } else {
            expect({ source: subject.source, personId: subject.personId }).toEqual(expected);
        }
    });

    test.each([
        ['on Patient $everything', false, ['p1'], 'only supported on Person $everything'],
        ['with more than one Person id', true, ['p1', 'p2'], 'one Person per request'],
        ['with no Person id', true, [], 'one Person per request']
    ])('a service token opting in %s is a 400', (_name, isPersonEverything, personIds, message) => {
        expect(() => getEverythingViewControlSubject({
            parsedArgs: args('true'), requestInfo: service, isPersonEverything, personIds
        })).toThrow(expect.objectContaining({ statusCode: 400, message: expect.stringContaining(message) }));
    });
});
