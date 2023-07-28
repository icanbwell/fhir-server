const { RethrownError } = require('../../utils/rethrownError');
const { FixReferenceIdRunner } = require('./fixReferenceIdRunner');

/**
 * @classdesc Finds humanApi resources whose id needs to be changed and changes the id along with its references
 */
class FixReferenceIdHapiRunner extends FixReferenceIdRunner {
    /**
     * Get query for the resources whose id might change
     * @param {boolean} isHistoryCollection
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForResource(isHistoryCollection) {
        const queryPrefix = isHistoryCollection ? 'resource.' : '';
        // create a query from the parameters
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = this.getQueryFromParameters({ queryPrefix });

        // query to get resources that needs to be changes
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        const filterQuery = [
            { [`${queryPrefix}_sourceAssigningAuthority`]: 'humanapi' }
        ];

        // merge query and filterQuery
        if (Object.keys(query).length) {
            query = {
                $and: [query, ...filterQuery]
            };
        } else {
            query = {
                $and: filterQuery
            };
        }
        return query;
    }

    /**
     * Creates oldReference to newReference mapping collectionwise
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions }} mongoConfig
     * @param {string} collectionName
     * @return {Promise<void>}
     */
    async cacheReferencesAsync({ mongoConfig, collectionName }) {
        /**
         * @type {boolean}
         */
        const isHistoryCollection = collectionName.includes('_History');

        /**
         * @type {Object}
         */
        let projection = {
            _id: 0,
            _uuid: 1,
            _sourceId: 1,
            _sourceAssigningAuthority: 1,
            resourceType: 1,
            meta: {
                source: 1
            }
        };

        // for observation we need code.coding.code or code.text depending on the senario
        if (collectionName.includes('Observation')) {
            projection = {
                ...projection,
                code: {
                    coding: {
                        code: 1
                    },
                    text: 1
                }
            };
        }

        // if this is history collection then change the projection to contain _id at top and
        // rest of the fields inside resource field
        if (isHistoryCollection) {
            delete projection._id;

            projection = { _id: 0, resource: projection };
        }

        /**
         * @type {require('mongodb').collection}
         */
        const { collection, session, client } = await this.createSingeConnectionAsync({ mongoConfig, collectionName });

        try {
            /**
             * @type {import('mongodb').FindCursor<import('mongodb').WithId<import('mongodb').Document>>}
             */
            const cursor = collection.find(this.getQueryForResource(isHistoryCollection), { projection });

            while (await cursor.hasNext()) {
                /**
                 * @type {import('mongodb').WithId<import('mongodb').Document>}
                 */
                const doc = await cursor.next();

                // check if the resource id needs to changed and if it needs to changed
                // then create its mapping in the cache
                this.cacheReferenceFromResource({
                    doc: isHistoryCollection ? doc.resource : doc, collectionName
                });
            }
        } catch (e) {
            throw new RethrownError(
                {
                    message: `Error caching references for collection ${collectionName}`,
                    error: e,
                    source: 'FixReferenceIdRunner.cacheReferencesAsync'
                }
            );
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Extracts id from document
     * @param {Resource} doc
     * @param {boolean} _sanitize
     * @returns {string}
     */
    getOriginalId({ doc, _sanitize }) {
        // for observation resource we need to check if the resource is observation and id length is 64
        if (doc.resourceType === 'Observation' && doc._sourceId.length === 64) {
            // to check if doc.code exists and the sourceId has some suffix at the end
            if (doc.code && doc._sourceId.split('-').length > 2) {
                // 1st fallback to add doc.code.coding[0].code if it exists
                if (doc.code.coding && doc.code.coding.length && doc.code.coding[0].code) {
                    return `${doc._sourceId.split('-')[1]}-${doc.code.coding[0].code.replace(/[^A-Za-z0-9\-.]/g, '-')}`;
                // 2nd fallback to add doc.code.text
                } else if (doc.code.text) {
                    return `${doc._sourceId.split('-')[1]}-${doc.code.text.replace(/[^A-Za-z0-9\-.]/g, '-')}`;
                }
            }
        }

        // normally humanapi resources are less than 63 characters, so to get original id
        // just remove the sourceAssigningAuthority from the start
        return doc._sourceId.replace('HumanApi-', '');
    }

    /**
     * Created old id from original id
     * @param {string} originalId
     * @returns {[string]}
     */
    getCurrentIds({ originalId }) {
        return [(`HumanApi-${originalId}`).slice(0, 64)];
    }
}

module.exports = {
    FixReferenceIdHapiRunner
};
