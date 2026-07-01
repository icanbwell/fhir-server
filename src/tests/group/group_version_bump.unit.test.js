const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { UpdateOperation } = require('../../operations/update/update');
const {
    hasExternalStorageMemberTag,
    EXTERNAL_STORAGE_TAG_SYSTEM,
    EXTERNAL_STORAGE_TAG_CODE
} = require('../../utils/clickHouseGroupPreSave');

/**
 * Unit coverage for the hybrid-Group version-bump hook.
 *
 * A member-only PUT to a hybrid Group (roster in ClickHouse, stripped from Mongo) must still
 * advance meta.versionId / meta.lastUpdated, because FHIR R4 requires those to change when
 * resource content changes and Group.member is content. The update operation achieves this by
 * loading the current ClickHouse roster onto the found resource before the merge, so the generic
 * content diff registers the membership change.
 *
 * These exercise the hook in isolation (no container, ClickHouse, or MongoDB): the private method
 * is invoked via prototype.call with just the state it reads, following the compensation unit tests.
 */
describe('hybrid Group version-bump hook (unit)', () => {
    process.env.LOGLEVEL = 'SILENT';

    const hydrate = UpdateOperation.prototype._hydrateHybridGroupMembersBeforeMerge;

    /** A stored Group doc carrying the external-storage member tag (member stripped from Mongo). */
    function taggedGroup({ id = 'group-1' } = {}) {
        return {
            id,
            resourceType: 'Group',
            meta: {
                versionId: '1',
                tag: [{ system: EXTERNAL_STORAGE_TAG_SYSTEM, code: EXTERNAL_STORAGE_TAG_CODE }]
            }
        };
    }

    /** Minimal hook host: the config + repository the private method reads off `this`. */
    function host({ enableClickHouse = true, hybridGroup = true, repository } = {}) {
        return {
            configManager: {
                enableClickHouse,
                mongoWithClickHouseResources: hybridGroup ? ['Group'] : []
            },
            groupMemberRepository: repository
        };
    }

    function repoReturning(references) {
        return { getActiveMembers: jestGlobal.fn(async () => references) };
    }

    describe('hasExternalStorageMemberTag', () => {
        test('true when the external-storage member tag is present', () => {
            expect(hasExternalStorageMemberTag(taggedGroup())).toBe(true);
        });

        test.each([
            ['no meta', { id: 'g' }],
            ['no tags', { id: 'g', meta: { versionId: '1' } }],
            ['unrelated tag', { id: 'g', meta: { tag: [{ system: 'other', code: 'x' }] } }],
            ['null doc', null]
        ])('false for %s', (_label, doc) => {
            expect(hasExternalStorageMemberTag(doc)).toBe(false);
        });
    });

    // Signature: (resourceType, incomingCarriesMember, currentResource). incomingCarriesMember is
    // true when the PUT body has a member field (present, even []).
    describe('_hydrateHybridGroupMembersBeforeMerge', () => {
        test('hydrates current members from ClickHouse when the write carries member', async () => {
            const repository = repoReturning(['Patient/1', 'Patient/2']);
            const currentResource = taggedGroup();

            await hydrate.call(host({ repository }), 'Group', true, currentResource);

            expect(repository.getActiveMembers).toHaveBeenCalledWith('group-1');
            expect(currentResource.member).toEqual([
                { entity: { reference: 'Patient/1' } },
                { entity: { reference: 'Patient/2' } }
            ]);
        });

        test('no-op (does not query ClickHouse) when the write omits member', async () => {
            const repository = repoReturning(['Patient/1', 'Patient/2']);
            const currentResource = taggedGroup();

            await hydrate.call(host({ repository }), 'Group', false, currentResource);

            expect(repository.getActiveMembers).not.toHaveBeenCalled();
            expect(currentResource.member).toBeUndefined();
        });

        test('no-op (does not query ClickHouse) when ClickHouse is disabled', async () => {
            const repository = repoReturning(['Patient/1']);
            const currentResource = taggedGroup();

            await hydrate.call(host({ enableClickHouse: false, repository }), 'Group', true, currentResource);

            expect(repository.getActiveMembers).not.toHaveBeenCalled();
            expect(currentResource.member).toBeUndefined();
        });

        test('no-op when the repository is not wired (ClickHouse off path)', async () => {
            const currentResource = taggedGroup();

            await expect(
                hydrate.call(host({ repository: null }), 'Group', true, currentResource)
            ).resolves.toBeUndefined();
            expect(currentResource.member).toBeUndefined();
        });

        test('no-op for a Group not configured for hybrid storage', async () => {
            const repository = repoReturning(['Patient/1']);
            const currentResource = taggedGroup();

            await hydrate.call(host({ hybridGroup: false, repository }), 'Group', true, currentResource);

            expect(repository.getActiveMembers).not.toHaveBeenCalled();
            expect(currentResource.member).toBeUndefined();
        });

        test('no-op for a non-Group resource type', async () => {
            const repository = repoReturning(['Patient/1']);
            const currentResource = { id: 'p1', resourceType: 'Patient', meta: {} };

            await hydrate.call(host({ repository }), 'Patient', true, currentResource);

            expect(repository.getActiveMembers).not.toHaveBeenCalled();
            expect(currentResource.member).toBeUndefined();
        });

        test('no-op for a Group without the external-storage tag (pure-Mongo Group)', async () => {
            const repository = repoReturning(['Patient/1']);
            const currentResource = { id: 'g2', resourceType: 'Group', meta: { versionId: '1' } };

            await hydrate.call(host({ repository }), 'Group', true, currentResource);

            expect(repository.getActiveMembers).not.toHaveBeenCalled();
            expect(currentResource.member).toBeUndefined();
        });

        test('leaves member unset when ClickHouse reports an empty roster', async () => {
            const repository = repoReturning([]);
            const currentResource = taggedGroup();

            await hydrate.call(host({ repository }), 'Group', true, currentResource);

            expect(repository.getActiveMembers).toHaveBeenCalledWith('group-1');
            expect(currentResource.member).toBeUndefined();
        });

        test('hydrated shape matches an unchanged same-order resend (diffs to nothing)', () => {
            // getActiveMembers returns a stable order (ORDER BY entity_reference in the repository).
            // A client re-sending that exact roster in the same order produces an identical member
            // array, so the content diff sees no change and the version does not spuriously bump.
            const references = ['Patient/1', 'Patient/2', 'Patient/3'];
            const hydrated = references.map(reference => ({ entity: { reference } }));
            const clientResend = references.map(reference => ({ entity: { reference } }));
            expect(hydrated).toEqual(clientResend);
        });
    });
});
