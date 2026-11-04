const { EnrichmentProvider } = require('./enrichmentProvider');
const { MONGO_GROUP_EXTENDED_FIELD } = require('../../utils/mongoGroupExtendedTag');
const { generateUUIDv5 } = require('../../utils/uid.util');

// Deliberately a different system/code pair than clickHouseGroupPreSave's
// externalStorageFields|member tag -- the two external-storage mechanisms for Group.member
// share no tag value, so a Group is never ambiguously tracked by both at once.
const MONGO_GROUP_MEMBER_TAG_SYSTEM = 'https://www.icanbwell.com/groupSize';
const MONGO_GROUP_MEMBER_TAG_CODE = 'extended';

class GroupExtendedTagEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object[]} resources
     * @return {Promise<Object[]>}
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
     * @param {Object} doc - The Group resource being enriched
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

        doc.meta.tag = [...existingTags, newTag];
    }
}

module.exports = {
    GroupExtendedTagEnrichmentProvider,
    MONGO_GROUP_MEMBER_TAG_SYSTEM,
    MONGO_GROUP_MEMBER_TAG_CODE
};
