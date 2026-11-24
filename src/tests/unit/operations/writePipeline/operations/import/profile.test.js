const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('@icanbwell/fhirpatientsummary', () => ({
    ComprehensiveIPSCompositionBuilder: class ComprehensiveIPSCompositionBuilder {},
    TBundle: class TBundle {}
}));

const { createContainer } = require('../../../../../../createContainer');
const { IMPORT_WRITE_PROFILE } = require('../../../../../../operations/writePipeline/operations/import/profile');
const {
    ADMIN_LINK_WRITE_PROFILE,
    ADMIN_PATIENT_REFERENCE_WRITE_PROFILE
} = require('../../../../../../operations/writePipeline/operations/admin/profile');
const { CREATE_WRITE_PROFILE } = require('../../../../../../operations/writePipeline/operations/create/profile');
const { MERGE_WRITE_PROFILE } = require('../../../../../../operations/writePipeline/operations/merge/profile');
const { PATCH_WRITE_PROFILE } = require('../../../../../../operations/writePipeline/operations/patch/profile');
const { UPDATE_WRITE_PROFILE } = require('../../../../../../operations/writePipeline/operations/update/profile');
const { ImportResponder } = require('../../../../../../operations/writePipeline/operations/import/responder');
const { WritePipelineSwitch } = require('../../../../../../operations/writePipeline/writePipelineSwitch');

describe('IMPORT_WRITE_PROFILE', () => {
    test('asks for the u letter with the merge action, turns off the stored validation and result access checks and fails the item a check error came from', () => {
        expect(IMPORT_WRITE_PROFILE).toStrictEqual({
            name: 'import',
            accessRequested: 'u',
            action: 'merge',
            off: ['validateAgainstStored', 'accessOnResult'],
            itemErrorsFailItem: true
        });
    });

    test.each([
        { profile: MERGE_WRITE_PROFILE },
        { profile: CREATE_WRITE_PROFILE },
        { profile: UPDATE_WRITE_PROFILE },
        { profile: PATCH_WRITE_PROFILE },
        { profile: ADMIN_LINK_WRITE_PROFILE },
        { profile: ADMIN_PATIENT_REFERENCE_WRITE_PROFILE }
    ])('the $profile.name profile does not set itemErrorsFailItem', ({ profile }) => {
        expect(Object.hasOwn(profile, 'itemErrorsFailItem')).toBe(false);
    });

    test('names no variants, so it runs the $merge defaults', () => {
        expect(IMPORT_WRITE_PROFILE.variants).toBeUndefined();
    });

    test('is frozen, with a frozen off list', () => {
        expect(Object.isFrozen(IMPORT_WRITE_PROFILE)).toBe(true);
        expect(Object.isFrozen(IMPORT_WRITE_PROFILE.off)).toBe(true);
    });

    test('is named as an operation the write pipeline switch knows', () => {
        expect(WritePipelineSwitch.OPERATIONS).toContain(IMPORT_WRITE_PROFILE.name);
    });

    test('is registered with the write pipeline the container builds', () => {
        const container = createContainer();

        expect(container.writePipeline.registeredProfiles.has(IMPORT_WRITE_PROFILE)).toBe(true);
    });

    test('is registered with the container next to an import responder', () => {
        const container = createContainer();

        expect(container.importResponder).toBeInstanceOf(ImportResponder);
        expect(container.importResponder).toBe(container.importResponder);
    });
});
