// =============================================================================
// Shared universe for the systematic FHIR-server security matrix.
//
// This is not a regression fixture set built from prior tickets. It enumerates
// every visibility CLASS a resource can belong to under the security model, so the
// matrix suites can assert the EXACT set of resources each caller type should see
// through each endpoint. Asserting an exact set catches over-sharing and
// under-sharing with the same assertion.
//
// Visibility classes (the access rule is: a caller may read a resource if it
// holds at least one of that resource's access tags -- SAE-1):
//
//   OWN_A        owner tenanta, access [tenanta]              -> only A
//   OWN_B        owner tenantb, access [tenantb]              -> only B
//   SHARED_AB    owner tenantb, access [tenanta, tenantb]     -> A and B  (SAE-1 / SAE-2)
//   PROA         owner proasrc,  access [proasrc], proa       -> only proasrc, unless consent
//   IAS          owner iassrc,   access [iassrc],  ias        -> only iassrc, unless consent
//   NO_ACCESS    owner tenanta, access []                     -> nobody (fail closed)
//   ORPHAN       owner tenantb, access [tenantb], unlinked    -> only B; must never appear
//                                                                via any traversal
//
// Person graph, with |sourceAssigningAuthority on every cross-owner link.
// (ReferenceGlobalIdHandler derives a link target's _uuid as uuidv5(id|SAA) and
// defaults to the PARENT's authority when the suffix is omitted, which silently
// produces a dangling link and a test that passes for the wrong reason.)
//
//   personA (tenanta) -> OWN_A, PROA, IAS
//   personB (tenantb) -> OWN_B, SHARED_AB
//
// =============================================================================
const OWNER = 'https://www.icanbwell.com/owner';
const ACCESS = 'https://www.icanbwell.com/access';
const CONNTYPE = 'https://www.icanbwell.com/connectionType';

const T_A = 'tenanta';
const T_B = 'tenantb';
const S_PROA = 'proasrc';
const S_IAS = 'iassrc';

function sec (owner, accessCodes, connectionType) {
    const tags = [{ system: OWNER, code: owner }];
    for (const a of accessCodes) tags.push({ system: ACCESS, code: a });
    if (connectionType) tags.push({ system: CONNTYPE, code: connectionType });
    return tags;
}

function patient (id, owner, accessCodes, connectionType) {
    return {
        resourceType: 'Patient',
        id,
        meta: { source: owner, security: sec(owner, accessCodes, connectionType) },
        // identical demographics everywhere on purpose: demographic likeness must
        // never be what separates two people's records
        name: [{ use: 'official', family: 'Matrix', given: ['Test'] }],
        gender: 'female',
        birthDate: '1985-06-15'
    };
}

function observation (id, owner, accessCodes, connectionType, patientId) {
    return {
        resourceType: 'Observation',
        id,
        meta: { source: owner, security: sec(owner, accessCodes, connectionType) },
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }] },
        subject: { reference: `Patient/${patientId}|${owner}` }
    };
}

function person (id, owner, accessCodes, links) {
    return {
        resourceType: 'Person',
        id,
        meta: { source: owner, security: sec(owner, accessCodes) },
        name: [{ use: 'official', family: 'Matrix', given: ['Test'] }],
        gender: 'female',
        birthDate: '1985-06-15',
        link: links.map((l) => ({
            target: { reference: `Patient/${l.id}|${l.saa}`, type: 'Patient' },
            assurance: l.assurance || 'level4'
        }))
    };
}

// ---- Patients, one per visibility class ------------------------------------
const P = {
    OWN_A:     patient('mtxOwnA', T_A, [T_A]),
    OWN_B:     patient('mtxOwnB', T_B, [T_B]),
    SHARED_AB: patient('mtxSharedAB', T_B, [T_A, T_B]),
    PROA:      patient('mtxProa', S_PROA, [S_PROA], 'proa'),
    IAS:       patient('mtxIas', S_IAS, [S_IAS], 'ias'),
    NO_ACCESS: patient('mtxNoAccess', T_A, []),
    ORPHAN:    patient('mtxOrphanB', T_B, [T_B])
};

// ---- Observations, tagged identically to their patient ---------------------
const O = {
    OWN_A:     observation('mtxObsOwnA', T_A, [T_A], null, 'mtxOwnA'),
    OWN_B:     observation('mtxObsOwnB', T_B, [T_B], null, 'mtxOwnB'),
    SHARED_AB: observation('mtxObsSharedAB', T_B, [T_A, T_B], null, 'mtxSharedAB'),
    PROA:      observation('mtxObsProa', S_PROA, [S_PROA], 'proa', 'mtxProa'),
    IAS:       observation('mtxObsIas', S_IAS, [S_IAS], 'ias', 'mtxIas'),
    NO_ACCESS: observation('mtxObsNoAccess', T_A, [], null, 'mtxNoAccess'),
    ORPHAN:    observation('mtxObsOrphanB', T_B, [T_B], null, 'mtxOrphanB')
};

// ---- Persons ---------------------------------------------------------------
const PERSON = {
    A: person('mtxPersonA', T_A, [T_A], [
        { id: 'mtxOwnA', saa: T_A },
        { id: 'mtxProa', saa: S_PROA },
        { id: 'mtxIas', saa: S_IAS }
    ]),
    B: person('mtxPersonB', T_B, [T_B], [
        { id: 'mtxOwnB', saa: T_B },
        { id: 'mtxSharedAB', saa: T_B }
    ])
};

const ALL = [
    ...Object.values(P),
    ...Object.values(O),
    ...Object.values(PERSON)
];

// ---- Expected direct-read visibility, derived from the access-tag rule ------
// "Which patients may this caller read directly?" -- the ground truth every
// endpoint assertion is measured against.
const EXPECTED_PATIENTS = {
    tenantA:  ['mtxOwnA', 'mtxSharedAB'],
    tenantB:  ['mtxOwnB', 'mtxSharedAB', 'mtxOrphanB'],
    proaSrc:  ['mtxProa'],
    iasSrc:   ['mtxIas'],
    // NO_ACCESS belongs to nobody: a resource with no access tag must fail closed
    wildcard: ['mtxOwnA', 'mtxOwnB', 'mtxSharedAB', 'mtxProa', 'mtxIas', 'mtxNoAccess', 'mtxOrphanB']
};

const EXPECTED_OBSERVATIONS = {
    tenantA:  ['mtxObsOwnA', 'mtxObsSharedAB'],
    tenantB:  ['mtxObsOwnB', 'mtxObsSharedAB', 'mtxObsOrphanB'],
    proaSrc:  ['mtxObsProa'],
    iasSrc:   ['mtxObsIas'],
    wildcard: ['mtxObsOwnA', 'mtxObsOwnB', 'mtxObsSharedAB', 'mtxObsProa', 'mtxObsIas', 'mtxObsNoAccess', 'mtxObsOrphanB']
};

// $everything on personA: the person, its own patient and that patient's
// observation. The PROA and IAS patients are LINKED but carry none of A's tags
// and have no Consent, so IDG-5 requires they be withheld.
const EXPECTED_EVERYTHING_PERSON_A = {
    tenantA: ['mtxPersonA', 'mtxOwnA', 'mtxObsOwnA'],
    withheld: ['mtxProa', 'mtxObsProa', 'mtxIas', 'mtxObsIas', 'mtxOwnB', 'mtxObsOwnB', 'mtxOrphanB', 'mtxObsOrphanB']
};

module.exports = {
    OWNER, ACCESS, CONNTYPE, T_A, T_B, S_PROA, S_IAS,
    patient, observation, person, sec,
    P, O, PERSON, ALL,
    EXPECTED_PATIENTS, EXPECTED_OBSERVATIONS, EXPECTED_EVERYTHING_PERSON_A
};
