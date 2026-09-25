const { describe, test, expect } = require('@jest/globals');

const {
    GroupExtendedTagEnrichmentProvider,
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE
} = require('../../../../enrich/providers/groupExtendedTagEnrichmentProvider');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../../../utils/mongoGroupExtendedTag');

describe('GroupExtendedTagEnrichmentProvider', () => {
    const provider = new GroupExtendedTagEnrichmentProvider();

    function extendedGroup (overrides = {}) {
        return {
            resourceType: 'Group',
            id: 'group-1',
            meta: { versionId: '1', tag: [] },
            [MONGO_GROUP_EXTENDED_FIELD]: true,
            ...overrides
        };
    }

    describe('enrichAsync', () => {
        test('adds the groupSize|extended tag to a Group carrying the internal extended field', async () => {
            const resources = [extendedGroup()];

            const result = await provider.enrichAsync({ resources });

            expect(result[0].meta.tag).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        system: MONGO_GROUP_MEMBER_TAG_SYSTEM,
                        code: MONGO_GROUP_MEMBER_TAG_CODE
                    })
                ])
            );
        });

        test('does not add the tag to a Group without the internal extended field', async () => {
            const resources = [{
                resourceType: 'Group',
                id: 'group-2',
                meta: { versionId: '1', tag: [] }
            }];

            const result = await provider.enrichAsync({ resources });

            expect(result[0].meta.tag).toEqual([]);
        });

        test('does not add the tag to a non-Group resource, even if it carries the internal field', async () => {
            const resources = [{
                resourceType: 'Patient',
                id: 'patient-1',
                meta: { versionId: '1', tag: [] },
                [MONGO_GROUP_EXTENDED_FIELD]: true
            }];

            const result = await provider.enrichAsync({ resources });

            expect(result[0].meta.tag).toEqual([]);
        });

        test('is idempotent -- does not duplicate the tag if already present', async () => {
            const resources = [extendedGroup({
                meta: {
                    versionId: '1',
                    tag: [{ system: MONGO_GROUP_MEMBER_TAG_SYSTEM, code: MONGO_GROUP_MEMBER_TAG_CODE }]
                }
            })];

            const result = await provider.enrichAsync({ resources });

            expect(result[0].meta.tag).toHaveLength(1);
        });

        test('handles multiple resources independently', async () => {
            const resources = [
                extendedGroup({ id: 'group-extended' }),
                {
                    resourceType: 'Group',
                    id: 'group-embedded',
                    meta: { versionId: '1', tag: [] }
                }
            ];

            const result = await provider.enrichAsync({ resources });

            expect(result[0].meta.tag).toHaveLength(1);
            expect(result[1].meta.tag).toEqual([]);
        });

        test('returns the resources array', async () => {
            const resources = [extendedGroup()];

            const result = await provider.enrichAsync({ resources });

            expect(result).toBe(resources);
        });
    });

    describe('enrichBundleEntriesAsync', () => {
        test('adds the tag to Group resources inside bundle entries', async () => {
            const entries = [
                { resource: extendedGroup() },
                { resource: { resourceType: 'Group', id: 'group-embedded', meta: { versionId: '1', tag: [] } } }
            ];

            const result = await provider.enrichBundleEntriesAsync({ entries });

            expect(result[0].resource.meta.tag).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        system: MONGO_GROUP_MEMBER_TAG_SYSTEM,
                        code: MONGO_GROUP_MEMBER_TAG_CODE
                    })
                ])
            );
            expect(result[1].resource.meta.tag).toEqual([]);
        });

        test('skips entries without a resource', async () => {
            const entries = [{ fullUrl: 'http://example.com' }];

            const result = await provider.enrichBundleEntriesAsync({ entries });

            expect(result).toEqual(entries);
        });
    });
});
