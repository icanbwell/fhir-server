const { describe, test, expect } = require('@jest/globals');
const { resolveMemberWrite } = require('../../../../operations/common/resolveMemberWrite');

describe('resolveMemberWrite', () => {
    test('add with no existing member classifies as create', () => {
        const result = resolveMemberWrite(undefined, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'add'
        });
        expect(result.writeType).toBe('create');
        expect(result.member).toEqual({ entity: { reference: 'Patient/1' }, inactive: false });
    });

    test('add over an existing inactive member classifies as update and flips inactive back to false', () => {
        // A reactivation and a plain field update are distinguished internally (the resolver
        // needs to know whether to flip `inactive` back to `false`), but both write the same
        // `member` shape via the same replaceOneAsync path, and nothing downstream ever needs
        // to tell them apart -- so both are tagged `update`, not a separate `reactivate` value.
        const existing = { entity: { reference: 'Patient/1' }, inactive: true };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'add'
        });
        expect(result.writeType).toBe('update');
        expect(result.member.inactive).toBe(false);
    });

    test('add with a changed field over an existing active member classifies as update', () => {
        const existing = { entity: { reference: 'Patient/1', display: 'old' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1', display: 'new' }, period: undefined, op: 'add'
        });
        expect(result.writeType).toBe('update');
        expect(result.member.entity.display).toBe('new');
    });

    test('add with no changes over an existing active member classifies as none', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'add'
        });
        expect(result.writeType).toBe('none');
    });

    test('add with a changed period over an existing active member classifies as update', () => {
        const existing = { entity: { reference: 'Patient/1' }, period: { start: '2026-01-01' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: { start: '2026-02-01', end: '2026-06-30' }, op: 'add'
        });
        expect(result.writeType).toBe('update');
        expect(result.member.period).toEqual({ start: '2026-02-01', end: '2026-06-30' });
    });

    test('add with a changed entity.type over an existing active member classifies as update', () => {
        const existing = { entity: { reference: 'Patient/1', type: 'Patient' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1', type: 'Person' }, period: undefined, op: 'add'
        });
        expect(result.writeType).toBe('update');
        expect(result.member.entity.type).toBe('Person');
    });

    test('add carries entity._uuid/_sourceId/_sourceAssigningAuthority through from the enriched change', () => {
        const result = resolveMemberWrite(undefined, {
            entity: {
                reference: 'Patient/1',
                _uuid: 'Patient/uuid-1',
                _sourceId: 'Patient/1',
                _sourceAssigningAuthority: 'test-owner'
            },
            period: undefined,
            op: 'add'
        });
        expect(result.writeType).toBe('create');
        expect(result.member.entity).toEqual({
            reference: 'Patient/1',
            _uuid: 'Patient/uuid-1',
            _sourceId: 'Patient/1',
            _sourceAssigningAuthority: 'test-owner'
        });
    });

    test('add carries entity.id/entity.extension through from the enriched change', () => {
        const result = resolveMemberWrite(undefined, {
            entity: {
                reference: 'Patient/1',
                id: 'entity-elem-1',
                extension: [{ url: 'http://example.com/entity-ext', valueString: 'y' }]
            },
            period: undefined,
            op: 'add'
        });
        expect(result.writeType).toBe('create');
        expect(result.member.entity.id).toBe('entity-elem-1');
        expect(result.member.entity.extension).toEqual([{ url: 'http://example.com/entity-ext', valueString: 'y' }]);
    });

    test('add with no entity.extension/id supplied carries the existing row value forward', () => {
        const existing = {
            entity: {
                reference: 'Patient/1',
                id: 'entity-elem-1',
                extension: [{ url: 'http://example.com/entity-ext', valueString: 'y' }]
            },
            inactive: false
        };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1', display: 'new' }, period: undefined, op: 'add'
        });
        expect(result.member.entity.id).toBe('entity-elem-1');
        expect(result.member.entity.extension).toEqual(existing.entity.extension);
    });

    test('add with no member-level id/extension/modifierExtension supplied carries the existing row value forward', () => {
        const existing = {
            id: 'member-1',
            extension: [{ url: 'http://example.com/ext', valueString: 'x' }],
            modifierExtension: [{ url: 'http://example.com/mod-ext', valueString: 'z' }],
            entity: { reference: 'Patient/1' },
            inactive: false
        };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1', display: 'new' }, period: undefined, op: 'add'
        });
        expect(result.member.id).toBe('member-1');
        expect(result.member.extension).toEqual(existing.extension);
        expect(result.member.modifierExtension).toEqual(existing.modifierExtension);
    });

    test('add always takes _uuid/_sourceId/_sourceAssigningAuthority from the write request, never falling back to the existing row', () => {
        // Unlike type/display/period, these three are never client-supplied -- PATCH bypasses
        // the normal pre-save pipeline, so groupMemberPatchStrategy.js always runs
        // enrichMemberReferences on every write request before resolveMemberWrite ever sees it,
        // unconditionally setting all three. A stale existing value must never win here.
        const existing = {
            entity: {
                reference: 'Patient/1',
                _uuid: 'Patient/old-uuid',
                _sourceId: 'Patient/old-source-id',
                _sourceAssigningAuthority: 'old-owner'
            },
            inactive: false
        };
        const result = resolveMemberWrite(existing, {
            entity: {
                reference: 'Patient/1',
                display: 'new',
                _uuid: 'Patient/new-uuid',
                _sourceId: 'Patient/new-source-id',
                _sourceAssigningAuthority: 'new-owner'
            },
            period: undefined,
            op: 'add'
        });
        expect(result.writeType).toBe('update');
        expect(result.member.entity._uuid).toBe('Patient/new-uuid');
        expect(result.member.entity._sourceId).toBe('Patient/new-source-id');
        expect(result.member.entity._sourceAssigningAuthority).toBe('new-owner');
    });

    test('add with no period/type/display/inactive supplied carries forward period/type/display but defaults inactive to false', () => {
        const existing = {
            entity: { reference: 'Patient/1', type: 'Patient', display: 'Jane' },
            period: { start: '2026-01-01' },
            inactive: true
        };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'add'
        });
        expect(result.writeType).toBe('update');
        expect(result.member).toEqual({
            entity: { reference: 'Patient/1', type: 'Patient', display: 'Jane' },
            period: { start: '2026-01-01' },
            inactive: false
        });
    });

    test('add with explicit inactive:true and no existing member classifies as create with inactive:true honored', () => {
        const result = resolveMemberWrite(undefined, {
            entity: { reference: 'Patient/1' }, period: undefined, inactive: true, op: 'add'
        });
        expect(result.writeType).toBe('create');
        expect(result.member).toEqual({ entity: { reference: 'Patient/1' }, inactive: true });
    });

    test('add with explicit inactive:true over an active member soft-deactivates (classified update, row not deleted)', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, inactive: true, op: 'add'
        });
        expect(result.writeType).toBe('update');
        expect(result.member.inactive).toBe(true);
    });

    test('add with explicit inactive:true restated over an already-inactive member classifies as none', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: true };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, inactive: true, op: 'add'
        });
        expect(result.writeType).toBe('none');
    });

    test('add with explicit inactive:false restated over an already-active member with no other change classifies as none', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, inactive: false, op: 'add'
        });
        expect(result.writeType).toBe('none');
    });

    test('remove with no existing member classifies as none', () => {
        const result = resolveMemberWrite(undefined, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'remove'
        });
        expect(result.writeType).toBe('none');
    });

    test('remove over an existing inactive member still classifies as delete', () => {
        // inactive is vestigial for the extended regime once remove hard-deletes rather than
        // soft-flagging -- a row can only be inactive:true today via data carried forward from
        // promotion (Task B3), never from this regime's own $member-remove. Removal must still
        // hard-delete it regardless of the flag's current value.
        const existing = { entity: { reference: 'Patient/1' }, inactive: true };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'remove'
        });
        expect(result.writeType).toBe('delete');
    });

    test('remove over an active member classifies as delete and preserves entity/period/inactive in the tombstone snapshot', () => {
        // The tombstone must reflect the member's actual last-known state, not an artificial
        // inactive:true stamped purely because it's being deleted -- that would misrepresent an
        // active member as having gone inactive, which is data pollution the history entry (and
        // any point-in-time reconstruction reading it) would then be stuck with permanently.
        const existing = {
            entity: { reference: 'Patient/1', display: 'kept' },
            period: { start: '2026-01-01' },
            inactive: false
        };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'remove'
        });
        expect(result.writeType).toBe('delete');
        expect(result.member).toEqual({
            entity: { reference: 'Patient/1', display: 'kept' },
            period: { start: '2026-01-01' },
            inactive: false
        });
    });

    test('remove over an inactive member preserves inactive:true (not overwritten) in the tombstone snapshot', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: true };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'remove'
        });
        expect(result.writeType).toBe('delete');
        expect(result.member.inactive).toBe(true);
    });

    test('remove carries entity.extension and backbone-level extension forward into the tombstone', () => {
        const existing = {
            id: 'member-1',
            extension: [{ url: 'http://example.com/ext', valueString: 'x' }],
            entity: { reference: 'Patient/1', extension: [{ url: 'http://example.com/entity-ext', valueString: 'y' }] },
            inactive: false
        };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'remove'
        });
        expect(result.member.id).toBe('member-1');
        expect(result.member.extension).toEqual(existing.extension);
        expect(result.member.entity.extension).toEqual(existing.entity.extension);
    });
});
