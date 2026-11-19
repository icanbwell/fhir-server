/**
 * The data view control lookup only ever removes data, so it must find the user's hidden resources
 * whatever tags those resources carry. Under the caller's own scope a resource whose access tag is
 * outside a service client's access codes, or one carrying the restricted tag (patient-scoped callers),
 * is not found, and what the user hid would be returned. This covers the attachment Binary of a hidden
 * DocumentReference, which is found by reading that DocumentReference. All data is synthetic.
 */
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');
const { FhirRequestInfo } = require('../../../../utils/fhirRequestInfo');
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../common');

const fx = (p) => require(`./fixtures/${p}`);
const SEED = [
    'Person/topLevelPerson.json',
    'Person/person1.json',
    'Patient/patient1.json',
    'Patient/patient3.json',
    'Binary/binary1.json'
];
const PERSON_ID = '5f3ca115-8630-5e55-a97d-4d6ee26c0adc';
const ACCESS = 'https://www.icanbwell.com/access';
const OWNER = 'https://www.icanbwell.com/owner';
const RESTRICTED = { system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'R' };
// documentReference1.json points at Binary/binary1
const BINARY_ID = 'binary1';

const SAME_TAGS = [
    { system: ACCESS, code: 'healthsystem1' },
    { system: OWNER, code: 'healthsystem1' }
];

const SERVICE_TOKEN = {
    user: 'service-client',
    scope: 'user/*.* access/healthsystem1.*',
    isUser: false,
    personIdFromJwtToken: null
};
const PATIENT_USER_TOKEN = {
    user: 'member',
    scope: 'patient/*.* user/*.*',
    isUser: true,
    personIdFromJwtToken: PERSON_ID
};

const requestInfoFor = (caller) =>
    new FhirRequestInfo({
        ...caller,
        userType: null,
        masterPersonIdFromJwtToken: null,
        managingOrganizationId: null,
        requestId: `tag-mismatch-${Math.random().toString(36).slice(2)}`,
        userRequestId: null,
        protocol: 'https',
        originalUrl: '/test',
        path: '/test',
        host: 'localhost',
        body: null,
        accept: 'application/fhir+json',
        headers: {},
        method: 'GET',
        contentTypeFromHeader: null,
        remoteIpAddress: null,
        alternateUserId: null
    });

describe('view control lookup finds hidden resources whatever their tags', () => {
    let request;
    let savedEnrolled;

    beforeEach(async () => {
        savedEnrolled = process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = 'healthsystem1';
        await commonBeforeEach();
        request = await createTestRequest();
        for (const p of SEED) {
            const resp = await request.post(`/4_0_0/${p.split('/')[0]}/1/$merge`).send(fx(p)).set(getHeaders());
            expect(resp.status).toBe(200);
        }
    });

    afterEach(async () => {
        if (savedEnrolled === undefined) delete process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL;
        else process.env.CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL = savedEnrolled;
        await commonAfterEach();
    });

    test.each([
        ['same tags as the Person', 'service token', SERVICE_TOKEN, SAME_TAGS],
        ['same tags as the Person', 'patient-scoped user token', PATIENT_USER_TOKEN, SAME_TAGS],
        [
            'an access tag outside the service client codes',
            'service token',
            SERVICE_TOKEN,
            [{ system: ACCESS, code: 'otherclient' }, { system: OWNER, code: 'healthsystem1' }]
        ],
        ['the restricted tag', 'patient-scoped user token', PATIENT_USER_TOKEN, [...SAME_TAGS, RESTRICTED]]
    ])(
        'a DocumentReference with %s, seen by a %s: its attachment Binary is still hidden',
        async (_tags, _caller, caller, documentReferenceSecurity) => {
            const documentReference = deepcopy(fx('DocumentReference/documentReference1.json'));
            documentReference.meta.security = documentReferenceSecurity;
            let resp = await request
                .post('/4_0_0/DocumentReference/1/$merge')
                .send(documentReference)
                .set(getHeaders());
            expect(resp.status).toBe(200);

            const db = await getTestContainer().mongoDatabaseManager.getClientDbAsync();
            const stored = await db.collection('DocumentReference_4_0_0').findOne({ _sourceId: documentReference.id });
            expect(stored).not.toBeNull();

            const consent = deepcopy(fx('Consent/consent1.json'));
            consent.provision.data = [
                { id: 'data-0', meaning: 'instance', reference: { reference: `DocumentReference/${stored._uuid}` } }
            ];
            resp = await request.post('/4_0_0/Consent/1/$merge').send(consent).set(getHeaders());
            expect(resp.status).toBe(200);

            const { viewControlResourceToExcludeMap } = await getTestContainer().patientDataViewControlManager.getConsentAsync({
                requestInfo: requestInfoFor(caller),
                base_version: '4_0_0',
                personId: PERSON_ID,
                owner: 'healthsystem1'
            });

            expect(viewControlResourceToExcludeMap.DocumentReference).toEqual([stored._uuid]);
            expect(viewControlResourceToExcludeMap.Binary).toEqual([BINARY_ID]);
        }
    );
});
