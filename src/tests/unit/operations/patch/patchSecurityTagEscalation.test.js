/**
 * Tests for PATCH privilege escalation via meta modification (DCON-4841).
 *
 * ORIGINAL REPORT: patchInternalFieldsValidator only blocks paths with segments starting with '_'
 * (underscore). meta.security, meta.source, meta.versionId, and meta.lastUpdated do NOT start with
 * '_', so this naming-convention-only check doesn't cover them.
 *
 * WHY THAT'S NOT ENOUGH TO CALL IT EXPLOITABLE ON ITS OWN: patch.js separately calls
 * resourceMerger.overWriteNonWritableFields, which reverts any attempted change to the owner/
 * sourceAssigningAuthority security tags and to meta.source/versionId/lastUpdated, for every
 * caller (see src/tests/patch/patch_meta/patch_meta.test.js's "doesn't work" tests, which already
 * covered this). The actual, narrower gap (fixed here) was that this revert call was only made
 * when meta.source was present on the stored or incoming resource -- a deployment with
 * REQUIRE_META_SOURCE_TAGS=false could have (or create) a resource with no meta.source at all,
 * and PATCHing that resource skipped the revert entirely, leaving those fields genuinely
 * reachable. See src/tests/patch/patch_owner_tag_change/patch_owner_tag_change.test.js for the
 * end-to-end regression test of that fix (in src/operations/patch/patch.js).
 *
 * meta.security's ACCESS tags are a separate mechanism entirely (not reverted by
 * overWriteNonWritableFields) and are validated by scopesValidator.isAccessTagChangeAllowedByAccessScopes
 * (SEC-1580 F2/F3), unaffected by any of this.
 *
 * File: src/operations/patch/validators/patchInternalFieldsValidator.js
 */
const { describe, test, expect } = require('@jest/globals');

const {
    validatePatchDoesNotTargetInternalFields,
    findInternalFieldInPath
} = require('../../../../operations/patch/validators/patchInternalFieldsValidator');

describe('patchInternalFieldsValidator', () => {
    describe('findInternalFieldInPath', () => {
        test('blocks paths starting with _', () => {
            expect(findInternalFieldInPath('/_uuid')).toBe('_uuid');
            expect(findInternalFieldInPath('/_sourceAssigningAuthority')).toBe('_sourceAssigningAuthority');
            expect(findInternalFieldInPath('/link/0/_uuid')).toBe('_uuid');
        });

        test('does not treat meta/security, meta/source, meta/versionId, meta/lastUpdated as internal -- ' +
            'those are protected downstream by overWriteNonWritableFields (DCON-4841) instead', () => {
            expect(findInternalFieldInPath('/meta/security')).toBeNull();
            expect(findInternalFieldInPath('/meta/security/0/code')).toBeNull();
            expect(findInternalFieldInPath('/meta/source')).toBeNull();
            expect(findInternalFieldInPath('/meta/versionId')).toBeNull();
            expect(findInternalFieldInPath('/meta/lastUpdated')).toBeNull();
        });
    });

    describe('validatePatchDoesNotTargetInternalFields', () => {
        test('allow PATCH that modifies non-internal fields', () => {
            const patchContent = [
                { op: 'replace', path: '/status', value: 'active' },
                { op: 'add', path: '/note/-', value: { text: 'updated' } },
                { op: 'replace', path: '/meta/security/0/code', value: 'attacker_tenant' },
                { op: 'replace', path: '/meta/source', value: 'https://evil.com' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).not.toThrow();
        });

        test('reject PATCH that targets a top-level internal field', () => {
            const patchContent = [
                { op: 'replace', path: '/_uuid', value: 'attacker-uuid' }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('reject PATCH whose value contains an internal field key', () => {
            const patchContent = [
                {
                    op: 'replace',
                    path: '/link/0/target',
                    value: { reference: 'Patient/1', _uuid: 'attacker-uuid' }
                }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).toThrow();
        });

        test('allow PATCH that modifies meta.tag (non-security tag)', () => {
            const patchContent = [
                {
                    op: 'add',
                    path: '/meta/tag/-',
                    value: { system: 'http://example.org/tags', code: 'reviewed' }
                }
            ];

            expect(() => {
                validatePatchDoesNotTargetInternalFields(patchContent);
            }).not.toThrow();
        });
    });
});
