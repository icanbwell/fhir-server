const { EnrichmentProvider } = require('./enrichmentProvider');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../utils/mongoGroupExtendedTag');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const { generateUUIDv5 } = require('../../utils/uid.util');

// Deliberately a different system/code pair than clickHouseGroupPreSave's
// externalStorageFields|member tag -- the two external-storage mechanisms for Group.member
// share no tag value, so a Group is never ambiguously tracked by both at once.
const MONGO_GROUP_MEMBER_TAG_SYSTEM = 'https://www.icanbwell.com/groupSize';
const MONGO_GROUP_MEMBER_TAG_CODE = 'extended';

class GroupExtendedTagEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Resource[]} resources
     * @return {Promise<Resource[]>}
     */
    async enrichAsync ({ resources }) {
        for (const resource of resources) {
            if (resource?.resourceType === 'Group' && resource[MONGO_GROUP_EXTENDED_FIELD] === true) {
                GroupExtendedTagEnrichmentProvider.addExtendedTagIfNeeded(resource);
            }
        }
        return resources;
    }

    /**
     * @param {BundleEntry[]} entries
     * @return {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries }) {
        for (const entry of entries) {
            if (entry.resource) {
                [entry.resource] = await this.enrichAsync({ resources: [entry.resource] });
            }
        }
        return entries;
    }

    /**
     * Adds the groupSize|extended tag to meta.tag on a Group resource if not already present.
     * Computed fresh on every read from the internal field -- never persisted -- so it can't
     * drift out of sync with it. Idempotent.
     *
     * @param {Resource} doc - The Group resource being enriched
     */
    static addExtendedTagIfNeeded (doc) {
        if (!doc || doc.resourceType !== 'Group' || !doc.meta) {
            return;
        }

        const existingTags = doc.meta.tag || [];
        const alreadyTagged = existingTags.some(
            t => t.system === MONGO_GROUP_MEMBER_TAG_SYSTEM && t.code === MONGO_GROUP_MEMBER_TAG_CODE
        );
        if (alreadyTagged) {
            return;
        }

        const newTag = {
            id: generateUUIDv5(`${MONGO_GROUP_MEMBER_TAG_SYSTEM}|${MONGO_GROUP_MEMBER_TAG_CODE}`),
            system: MONGO_GROUP_MEMBER_TAG_SYSTEM,
            code: MONGO_GROUP_MEMBER_TAG_CODE
        };

        // Cannot push to an empty array on the FHIR Resource class (its setter converts [] to
        // undefined), so always assign a fresh array.
        if (doc instanceof Resource) {
            doc.meta.tag = [...existingTags, new Coding(newTag)];
        } else {
            doc.meta.tag = [...existingTags, newTag];
        }
    }
}

module.exports = {
    GroupExtendedTagEnrichmentProvider,
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE
};
