const { describe, test, expect } = require('@jest/globals');
const { ConfigManager } = require('../../../../../../utils/configManager');
const { GroupMemberMerger } = require('../../../../../../operations/common/groupMemberMerger');
const { InsertBuilder } = require('../../../../../../operations/writePipeline/steps/build/insertBuilder');
const { WriteItem } = require('../../../../../../operations/writePipeline/writeItem');
const { WriteContext } = require('../../../../../../operations/writePipeline/writeContext');

/**
 * Builds the insert builder with the real member merger and the default configuration.
 */
const buildInsertBuilder = () => new InsertBuilder({
    groupMemberMerger: new GroupMemberMerger({ configManager: new ConfigManager() })
});

/**
 * Builds a write context for a POST with no request headers.
 */
const buildContext = () => new WriteContext({
    requestInfo: { requestId: 'request-1', headers: {} },
    base_version: '4_0_0',
    parsedArgs: {},
    smartMerge: false
});

/**
 * Builds an item whose body is a synthetic resource, with the `_sourceAssigningAuthority` preSave
 * sets.
 */
const buildItem = (incoming) => new WriteItem({
    index: 0,
    incoming: { _sourceAssigningAuthority: 'test-owner', meta: { source: 'http://example.com/source' }, ...incoming }
});

describe('InsertBuilder', () => {
    test('stamps the first version, uses the body as the candidate and marks the item an insert', async () => {
        const item = buildItem({ resourceType: 'Patient', id: 'patient-1' });

        const failure = await buildInsertBuilder().buildAsync({ item, context: buildContext() });

        expect(failure).toBeNull();
        expect(item.candidate).toBe(item.incoming);
        expect(item.candidate.meta.versionId).toBe('1');
        expect(item.candidate.meta.lastUpdated).toBeInstanceOf(Date);
        expect(item.writeMode).toBe('insert');
    });

    test('merges the entries of a Group member the body lists more than once', async () => {
        const item = buildItem({
            resourceType: 'Group',
            id: 'group-1',
            member: [
                { entity: { reference: 'Patient/a' } },
                { entity: { reference: 'Patient/b' } },
                { entity: { reference: 'Patient/a' }, period: { start: '2026-01-01' } }
            ]
        });

        await buildInsertBuilder().buildAsync({ item, context: buildContext() });

        expect(item.candidate.member.map((member) => member.entity.reference)).toStrictEqual([
            'Patient/a',
            'Patient/b'
        ]);
        expect(item.candidate.member[0].period).toStrictEqual({ start: '2026-01-01' });
    });

    test('fails only the item when the body sends more entries for one member than the limit allows', async () => {
        const member = { entity: { reference: 'Patient/a' } };
        const item = buildItem({
            resourceType: 'Group',
            id: 'group-1',
            member: Array.from({ length: 101 }, () => ({ ...member }))
        });

        await expect(buildInsertBuilder().buildAsync({ item, context: buildContext() }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});
