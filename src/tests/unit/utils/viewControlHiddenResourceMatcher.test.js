const { describe, test, expect } = require('@jest/globals');
const { createViewControlHiddenResourceMatcher } = require('../../../utils/viewControlHiddenResourceMatcher');

const UUID = 'f49c5e15-81b5-57a9-bade-77e9e744fb2e';
const OTHER_UUID = '98edd83a-bb70-547b-8f36-7f243658152f';

describe('createViewControlHiddenResourceMatcher', () => {
    test.each([
        ['an undefined map', undefined],
        ['an empty map', {}],
        ['only empty id lists', { CarePlan: [] }]
    ])('returns null when nothing is hidden: %s', (_name, excludeMap) => {
        expect(createViewControlHiddenResourceMatcher(excludeMap)).toBeNull();
    });

    test.each([
        ['a uuid matches _uuid', { CarePlan: [UUID] }, { resourceType: 'CarePlan', id: 'cp-1', _uuid: UUID }, true],
        ['a uuid does not match another _uuid', { CarePlan: [UUID] }, { resourceType: 'CarePlan', _uuid: OTHER_UUID }, false],
        ['a source id matches _sourceId', { CarePlan: ['cp-1'] }, { resourceType: 'CarePlan', _sourceId: 'cp-1', _uuid: UUID }, true],
        ['a source id matches id', { CarePlan: ['cp-1'] }, { resourceType: 'CarePlan', id: 'cp-1', _uuid: UUID }, true],
        ['an id|authority value ignores the authority', { CarePlan: ['cp-1|client-a'] }, { resourceType: 'CarePlan', id: 'cp-1' }, true],
        ['a source id does not match the uuid field', { CarePlan: ['cp-1'] }, { resourceType: 'CarePlan', _uuid: 'cp-1' }, false],
        ['the resourceType must match', { Observation: [UUID] }, { resourceType: 'CarePlan', _uuid: UUID }, false],
        ['a resource without a resourceType is not hidden', { CarePlan: [UUID] }, { _uuid: UUID }, false]
    ])('%s', (_name, excludeMap, resource, hidden) => {
        const isHidden = createViewControlHiddenResourceMatcher(excludeMap);
        expect(isHidden(resource)).toBe(hidden);
    });
});
