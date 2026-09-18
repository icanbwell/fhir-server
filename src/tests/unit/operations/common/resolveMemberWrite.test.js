const { describe, test, expect } = require('@jest/globals');
const { resolveMemberWrite } = require('../../../../operations/common/resolveMemberWrite');

describe('resolveMemberWrite', () => {
    test('add with no existing member classifies as create', () => {
        const result = resolveMemberWrite(undefined, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'add'
        });
        expect(result.classification).toBe('create');
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
        expect(result.classification).toBe('update');
        expect(result.member.inactive).toBe(false);
    });

    test('add with a changed field over an existing active member classifies as update', () => {
        const existing = { entity: { reference: 'Patient/1', display: 'old' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1', display: 'new' }, period: undefined, op: 'add'
        });
        expect(result.classification).toBe('update');
        expect(result.member.entity.display).toBe('new');
    });

    test('add with no changes over an existing active member classifies as none', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'add'
        });
        expect(result.classification).toBe('none');
    });

    test('add with a changed period over an existing active member classifies as update', () => {
        const existing = { entity: { reference: 'Patient/1' }, period: { start: '2026-01-01' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: { start: '2026-02-01', end: '2026-06-30' }, op: 'add'
        });
        expect(result.classification).toBe('update');
        expect(result.member.period).toEqual({ start: '2026-02-01', end: '2026-06-30' });
    });

    test('add with a changed entity.type over an existing active member classifies as update', () => {
        const existing = { entity: { reference: 'Patient/1', type: 'Patient' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1', type: 'Person' }, period: undefined, op: 'add'
        });
        expect(result.classification).toBe('update');
        expect(result.member.entity.type).toBe('Person');
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
        expect(result.classification).toBe('update');
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
        expect(result.classification).toBe('create');
        expect(result.member).toEqual({ entity: { reference: 'Patient/1' }, inactive: true });
    });

    test('add with explicit inactive:true over an active member soft-deactivates (classified update, row not deleted)', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, inactive: true, op: 'add'
        });
        expect(result.classification).toBe('update');
        expect(result.member.inactive).toBe(true);
    });

    test('add with explicit inactive:true restated over an already-inactive member classifies as none', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: true };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, inactive: true, op: 'add'
        });
        expect(result.classification).toBe('none');
    });

    test('add with explicit inactive:false restated over an already-active member with no other change classifies as none', () => {
        const existing = { entity: { reference: 'Patient/1' }, inactive: false };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, inactive: false, op: 'add'
        });
        expect(result.classification).toBe('none');
    });

    test('remove with no existing member classifies as none', () => {
        const result = resolveMemberWrite(undefined, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'remove'
        });
        expect(result.classification).toBe('none');
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
        expect(result.classification).toBe('delete');
    });

    test('remove over an active member classifies as delete and preserves entity/period in the tombstone snapshot', () => {
        const existing = {
            entity: { reference: 'Patient/1', display: 'kept' },
            period: { start: '2026-01-01' },
            inactive: false
        };
        const result = resolveMemberWrite(existing, {
            entity: { reference: 'Patient/1' }, period: undefined, op: 'remove'
        });
        expect(result.classification).toBe('delete');
        expect(result.member).toEqual({
            entity: { reference: 'Patient/1', display: 'kept' },
            period: { start: '2026-01-01' },
            inactive: true
        });
    });
});
