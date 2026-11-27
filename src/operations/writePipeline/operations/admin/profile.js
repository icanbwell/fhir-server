/**
 * The steps an admin write turns off: the scope check (the route checks the admin scope), and the
 * steps that read or validate a request body or compare it with the stored document, because an
 * admin request carries ids, not a resource.
 */
const ADMIN_STEPS_OFF = Object.freeze([
    'scopeCheck',
    'identify',
    'prepareBody',
    'validateIncoming',
    'validateNewResource',
    'validateAgainstStored'
]);

/**
 * The admin Person link profile, for the operations that add or remove a Person's link to a
 * Person or a Patient: it asks for the `u` scope letter with the `admin` action, loads the target
 * and the linked resource (`findExisting: 'adminTargets'`), checks that the caller may change the
 * target and see the linked resource (`accessBeforeBuild: 'adminTargets'`), builds the changed or
 * new Person (`buildDocument: 'admin'`) and checks the result's access tags
 * (`accessOnResult: 'admin'`). The result check runs its default, patient reference check
 * included.
 */
const ADMIN_LINK_WRITE_PROFILE = Object.freeze({
    name: 'adminLink',
    accessRequested: 'u',
    action: 'admin',
    off: ADMIN_STEPS_OFF,
    variants: Object.freeze({
        findExisting: 'adminTargets',
        accessBeforeBuild: 'adminTargets',
        buildDocument: 'admin',
        accessOnResult: 'admin'
    })
});

/**
 * The admin patient reference profile, for the operation that points a resource's patient
 * reference at another Patient: the admin Person link profile, except that its result check
 * (`validateResult: 'adminPatientReference'`) skips the patient reference check, because changing
 * that reference is the operation's purpose. As on the old path, the new Patient is not looked up
 * or access-checked.
 */
const ADMIN_PATIENT_REFERENCE_WRITE_PROFILE = Object.freeze({
    name: 'adminPatientReference',
    accessRequested: 'u',
    action: 'admin',
    off: ADMIN_STEPS_OFF,
    variants: Object.freeze({
        findExisting: 'adminTargets',
        accessBeforeBuild: 'adminTargets',
        buildDocument: 'admin',
        validateResult: 'adminPatientReference',
        accessOnResult: 'admin'
    })
});

module.exports = {
    ADMIN_LINK_WRITE_PROFILE,
    ADMIN_PATIENT_REFERENCE_WRITE_PROFILE
};
