// T15 / T16: GraphQL v2 DocumentReference -> content.attachment.resource returns the owner's Binary and null for
// every other member. This path (DocumentReferenceAttachment.resource -> dataSource.findLinkedNonClinicalResource
// -> DataLoader -> searchBundleAsync) is flagged in unit/graphqlv2/crossTenantPhiLeakage.test.js as possibly
// bypassing filters, so it is verified end to end here. GraphQL v1 has no attachment.resource field (its
// Attachment type is empty), so there is nothing to test there.
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getCustomGraphQLHeaders,
    mockHttpContext
} = require('../../common');
const { ConfigManager } = require('../../../../utils/configManager');
const { READER_TOKENS, memberClaims, createHelpers } = require('./binaryScopeTestHelpers');

class GraphqlConfigManager extends ConfigManager {
    get enablePatientScopedBinaryCreate () {
        return true;
    }
}

const query = `
query docs {
  documentReferences {
    entry {
      resource {
        id
        content {
          attachment {
            url
            resource {
              id
              contentType
              securityContext { reference }
            }
          }
        }
      }
    }
  }
}`;

describe('Binary with patient scope: GraphQL v2 DocumentReference -> attachment.resource', () => {
    let requestId;

    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    const setup = async () => {
        const request = await createTestRequest((c) => {
            c.register('configManager', () => new GraphqlConfigManager());
            return c;
        });
        const helpers = createHelpers(request, requestId);
        const seeded = await helpers.seedSharedPatientWithOwnedBinary();
        return { request, ...seeded };
    };

    const run = async (request, personUuid, scope) => {
        const resp = await request
            .post('/4_0_0/$graphqlv2')
            .send({ operationName: null, variables: {}, query })
            .set(getCustomGraphQLHeaders(memberClaims(personUuid, scope)));
        expect(resp).toHaveStatusCode(200);
        expect(resp.body.errors).toBeUndefined();
        const docs = resp.body.data.documentReferences.entry.map((e) => e.resource);
        return docs;
    };

    for (const { name, scope } of READER_TOKENS) {
        test(`T15: the owner (${name}) gets the Binary through attachment.resource`, async () => {
            const { request, personA, binaryId } = await setup();
            const docs = await run(request, personA, scope);
            expect(docs).toHaveLength(1);
            const attachment = docs[0].content[0].attachment;
            expect(attachment.url).toStrictEqual(`Binary/${binaryId}`);
            expect(attachment.resource).not.toBeNull();
            expect(attachment.resource.id).toStrictEqual(binaryId);
            expect(attachment.resource.securityContext.reference).toStrictEqual(`Patient/person.${personA}`);
        });

        test(`T16: another member (${name}) sees the DocumentReference but attachment.resource is null`, async () => {
            const { request, personB } = await setup();
            const docs = await run(request, personB, scope);
            // the shared-patient DocumentReference is visible to B, only the Binary behind it is hidden
            expect(docs).toHaveLength(1);
            expect(docs[0].content[0].attachment.resource).toBeNull();
        });
    }
});
