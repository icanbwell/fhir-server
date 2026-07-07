const fs = require('fs');
const path = require('path');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    createTestRequest
} = require('../../common');

const organization1Resource = require('./fixtures/organization/organization1.json');
const location1Resource = require('./fixtures/location/location1.json');
const location2Resource = require('./fixtures/location/location2.json');
const location3Resource = require('./fixtures/location/location3.json');

const locationQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query/locationManagingOrgDisplay.graphql'),
    'utf8'
);

const locationWithResourceQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query/locationManagingOrgDisplayWithResource.graphql'),
    'utf8'
);

const locationAliasedQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/query/locationManagingOrgDisplayAliased.graphql'),
    'utf8'
);

async function mergeFixtures (request) {
    let resp = await request
        .post('/4_0_0/Organization/org1/$merge')
        .send(organization1Resource)
        .set(getHeaders());
    // noinspection JSUnresolvedFunction
    expect(resp).toHaveMergeResponse({ created: true });

    for (const locationResource of [location1Resource, location2Resource, location3Resource]) {
        resp = await request
            .post(`/4_0_0/Location/${locationResource.id}/$merge`)
            .send(locationResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });
    }
}

// Location.managingOrganization.display should resolve to the managing
// organization's name when the stored reference has no display, while a stored
// display is preserved and a location without a managingOrganization is untouched.
describe('GraphQLV2 Location.managingOrganization.display enrichment', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('resolves organization name into display, preserves stored display', async () => {
        const request = await createTestRequest();
        const graphqlQueryText = locationQuery.replace(/\\n/g, '');

        await mergeFixtures(request);

        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        expect(resp.status).toBe(200);

        const entries = resp.body?.data?.locations?.entry || [];
        const displayByName = {};
        entries.forEach((entry) => {
            displayByName[entry.resource.name] = entry.resource.managingOrganization;
        });

        // loc1 reference has no display -> resolves to the organization name
        expect(displayByName['MSH Virtual (Telehealth POS 2)'].display).toBe('MedStar Health');
        // loc2 already has a stored display -> preserved, not overwritten
        expect(displayByName['Downtown Family Clinic'].display).toBe('Stored Organization Display');
        // loc3 has no managingOrganization -> nothing to resolve
        expect(displayByName['Standalone Clinic']).toBeNull();
    });

    test('resolves display even when the organization resource is also selected', async () => {
        const request = await createTestRequest();
        const graphqlQueryText = locationWithResourceQuery.replace(/\\n/g, '');

        await mergeFixtures(request);

        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        expect(resp.status).toBe(200);

        const entries = resp.body?.data?.locations?.entry || [];
        const managingOrgByName = {};
        entries.forEach((entry) => {
            managingOrgByName[entry.resource.name] = entry.resource.managingOrganization;
        });

        // Co-selecting `resource` builds an Organization projection; `name` must
        // still be available so the display resolver returns the organization name.
        expect(managingOrgByName['MSH Virtual (Telehealth POS 2)'].display).toBe('MedStar Health');
        expect(managingOrgByName['MSH Virtual (Telehealth POS 2)'].resource?.id).toBeTruthy();
    });

    test('resolves display when the field is aliased (e.g. orgName: display)', async () => {
        const request = await createTestRequest();
        const graphqlQueryText = locationAliasedQuery.replace(/\\n/g, '');

        await mergeFixtures(request);

        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({
                operationName: null,
                variables: {},
                query: graphqlQueryText
            })
            .set(getGraphQLHeaders());

        expect(resp.status).toBe(200);

        const entries = resp.body?.data?.locations?.entry || [];
        const managingOrgByName = {};
        entries.forEach((entry) => {
            managingOrgByName[entry.resource.name] = entry.resource.managingOrganization;
        });

        // Co-selecting `resource` builds an Organization projection that would prune
        // `name`. parseResolveInfo keys fields by response-key (the alias), so the
        // `name` projection must be added by matching on the field name, not the key;
        // otherwise the aliased display resolves to null.
        expect(managingOrgByName['MSH Virtual (Telehealth POS 2)'].orgName).toBe('MedStar Health');
        expect(managingOrgByName['MSH Virtual (Telehealth POS 2)'].resource?.id).toBeTruthy();
    });
});
