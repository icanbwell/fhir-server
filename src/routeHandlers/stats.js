/**
 * This route handler implements the /stats endpoint which shows the collections in mongo and the number of records in each
 */

const async = require('async');
const { RethrownError } = require('../utils/rethrownError');
const { logInfo } = require('../operations/common/logging');

/**
 * Builds a single-host direct connection string for one replica-set member, preserving
 * credentials/search params from the original connection. mongodb+srv is converted to a
 * standard mongodb:// direct connection (srv implies tls + authSource=admin on Atlas).
 * @param {string} originalConnection
 * @param {string} host host:port as returned by the `hello` command
 * @returns {string}
 */
function buildDirectMemberConnectionString (originalConnection, host) {
    const url = new URL(originalConnection);
    const wasSrv = url.protocol === 'mongodb+srv:';
    url.protocol = 'mongodb:';
    url.host = host;
    url.searchParams.set('directConnection', 'true');
    url.searchParams.delete('replicaSet');
    if (wasSrv) {
        if (!url.searchParams.has('tls') && !url.searchParams.has('ssl')) {
            url.searchParams.set('tls', 'true');
        }
        if (!url.searchParams.has('authSource')) {
            url.searchParams.set('authSource', 'admin');
        }
    }
    return url.toString();
}

/**
 * Returns the data-bearing member hosts of the replica set serving the given db.
 * @param {import('mongodb').Db} db
 * @returns {Promise<string[]>}
 */
async function getReplicaSetMemberHostsAsync (db) {
    try {
        const hello = await db.admin().command({ hello: 1 });
        const hosts = [
            ...(Array.isArray(hello.hosts) ? hello.hosts : []),
            ...(Array.isArray(hello.passives) ? hello.passives : [])
        ];
        return Array.from(new Set(hosts));
    } catch (error) {
        logInfo(`Could not determine replica set members: ${error.message}`, {});
        return [];
    }
}

/**
 * Opens a direct connection to each member host. Failures are skipped (not fatal).
 * @param {MongoDatabaseManager} mongoDatabaseManager
 * @param {string[]} hosts
 * @returns {Promise<{host: string, client: import('mongodb').MongoClient, db: import('mongodb').Db}[]>}
 */
async function openMemberClientsAsync (mongoDatabaseManager, hosts) {
    const baseConfig = await mongoDatabaseManager.getClientConfigAsync();
    const members = [];
    for (const host of hosts) {
        try {
            const connection = buildDirectMemberConnectionString(baseConfig.connection, host);
            const client = await mongoDatabaseManager.createClientAsync({
                connection,
                db_name: baseConfig.db_name,
                options: { ...baseConfig.options, directConnection: true }
            });
            members.push({ host, client, db: client.db(baseConfig.db_name) });
        } catch (error) {
            logInfo(`Could not connect to member ${host} for $indexStats: ${error.message}`, {});
        }
    }
    return members;
}

/**
 * Sums $indexStats usage for a collection across all replica-set members. accesses.ops is a
 * per-mongod counter, so an index is only a safe "unused" candidate when every member reports 0.
 * @param {string} collection_name
 * @param {{host: string, db: import('mongodb').Db}[]} memberDbs
 * @returns {Promise<{usage: Object[], membersQueried: number, memberCount: number, error: (string|null)}>}
 */
async function getIndexUsageAcrossMembersAsync (collection_name, memberDbs) {
    /**
     * @type {Object<string, {name: string, ops: number, since: (Date|null), perMember: Object}>}
     */
    const byIndex = {};
    let membersQueried = 0;
    /**
     * First per-member failure, surfaced so the caller can report why usage is empty
     * (e.g. the db user lacks the indexStats privilege) instead of returning a silent [].
     * @type {string|null}
     */
    let error = null;
    for (const member of memberDbs) {
        let indexStats;
        try {
            indexStats = await member.db.collection(collection_name)
                .aggregate([{ $indexStats: {} }]).toArray();
        } catch (e) {
            if (!error) {
                error = `${member.host}: ${e.message}`;
            }
            logInfo(`$indexStats failed on ${member.host} for ${collection_name}: ${e.message}`, {});
            continue;
        }
        membersQueried += 1;
        for (const s of indexStats) {
            const ops = s.accesses && s.accesses.ops ? Number(s.accesses.ops) : 0;
            const since = s.accesses ? s.accesses.since : null;
            if (!byIndex[s.name]) {
                byIndex[s.name] = { name: s.name, ops: 0, since: null, perMember: {} };
            }
            const rec = byIndex[s.name];
            rec.ops += ops;
            rec.perMember[member.host] = ops;
            if (since && (!rec.since || new Date(since) < new Date(rec.since))) {
                rec.since = since;
            }
        }
    }
    const usage = Object.values(byIndex).map((rec) => ({
        ...rec,
        // trustworthy only if every member was reachable and all reported zero
        unusedAcrossMembers: rec.ops === 0 && membersQueried === memberDbs.length && memberDbs.length > 0
    }));
    return { usage, membersQueried, memberCount: memberDbs.length, error };
}

/**
 * Handles stats
 * @param {function (): SimpleContainer} fnGetContainer
 * @param {import('http').IncomingMessage} req
 * @param {import('express').Response} res
 * @return {Promise<void>}
 */

module.exports.handleStats = async ({ fnGetContainer, req, res }) => {
    logInfo('Running stats', {});

    /**
     * gets stats for a collection
     * @param {string} collection_name
     * @param {import('mongodb').Db} db
     * @param {boolean} includeSizes when true, also collect data/index sizes and index usage
     * @param {{host: string, db: import('mongodb').Db}[]} memberDbs replica-set members for
     *   cross-member index usage; empty => single-node usage (standalone / separate cluster)
     * @return {Promise<{name, count: number, indexes: Omit<IndexInfo, 'v'>[]}>}
     */
    async function getStatsForCollectionAsync (collection_name, db, includeSizes, memberDbs) {
        logInfo(collection_name, {});
        const count = await db.collection(collection_name).estimatedDocumentCount();
        /**
         * @typedef {{ key: {[keyName: string]: number; v: number}; name: string}} IndexInfo
         * @type {IndexInfo[]}
         */
        const indexes = await db.collection(collection_name).indexes();
        logInfo(['Fetched index for collection: ', collection_name].join(''), { indexes });
        logInfo(['Found: ', count, ' documents in ', collection_name].join(''), {});
        const result = {
            name: collection_name,
            count,
            indexes: indexes.map((i) => ({ key: i.key, name: i.name }))
        };

        if (!includeSizes) {
            return result;
        }

        // Data + index sizes are identical across replica members, so read from one node.
        try {
            const collStats = await db.command({ collStats: collection_name });
            result.dataSize = collStats.size || 0;
            result.storageSize = collStats.storageSize || 0;
            result.totalIndexSize = collStats.totalIndexSize || 0;
            result.avgObjSize = collStats.avgObjSize || 0;
            result.indexSizes = collStats.indexSizes || {};
        } catch (error) {
            result.statsError = error.message;
        }

        // Index usage must be summed across ALL members: accesses.ops is per-mongod and reads are
        // secondaryPreferred, so a single node undercounts. 'since' shows the counter window.
        if (memberDbs && memberDbs.length > 0) {
            try {
                const { usage, membersQueried, memberCount, error } =
                    await getIndexUsageAcrossMembersAsync(collection_name, memberDbs);
                result.indexUsage = usage;
                result.indexUsageMembers = { queried: membersQueried, total: memberCount };
                // surface why usage is empty (e.g. missing indexStats privilege) instead of a silent []
                if (membersQueried === 0 && error) {
                    result.indexUsageError = error;
                }
            } catch (error) {
                result.indexUsageError = error.message;
            }
        } else {
            // standalone (tests) or a separate cluster (history): single-node usage
            try {
                const indexStats = await db.collection(collection_name)
                    .aggregate([{ $indexStats: {} }]).toArray();
                result.indexUsage = indexStats.map((s) => ({
                    name: s.name,
                    ops: s.accesses && s.accesses.ops ? Number(s.accesses.ops) : 0,
                    since: s.accesses ? s.accesses.since : null
                }));
                result.indexUsageMembers = { queried: 1, total: 1 };
            } catch (error) {
                result.indexUsageError = error.message;
            }
        }

        return result;
    }

    const container = fnGetContainer();
    /**
     * @type {MongoDatabaseManager}
     */
    const mongoDatabaseManager = container.mongoDatabaseManager;
    try {
        /**
         * @type {import('mongodb').Db}
         */
        const db = await mongoDatabaseManager.getClientDbAsync();
        const resourceHistoryDb = await mongoDatabaseManager.getResourceHistoryDbAsync();
        let collection_names = [];

        for await (const /** @type {{name: string, type: string}} */ collection of db.listCollections(
            {}, { nameOnly: true })) {
            if (collection.name.indexOf('system.') === -1) {
                collection_names.push(collection.name);
            }
        }
        // for resource history collections
        for await (const /** @type {{name: string, type: string}} */ collection of resourceHistoryDb.listCollections(
            {}, { nameOnly: true })) {
            if (collection.name.indexOf('system.') === -1) {
                collection_names.push(collection.name);
            }
        }

        // for backward compatability in case clientDB and resourceHistoryDB are same
        collection_names = new Set(collection_names.sort((a, b) => a.localeCompare(b)));
        logInfo(`Collection_names: ${collection_names}`, {});
        // opt-in heavy mode: /stats?sizes=true adds data/index sizes + index usage per collection
        const includeSizes = Boolean(req.query) && (req.query.sizes === 'true' || req.query.sizes === '1');

        // For cross-member index usage, open a direct connection to each member of the client-db
        // replica set. Only in sizes mode; skipped for standalone (e.g. tests, single host).
        /**
         * @type {{host: string, client: import('mongodb').MongoClient, db: import('mongodb').Db}[]}
         */
        let memberDbs = [];
        if (includeSizes) {
            const memberHosts = await getReplicaSetMemberHostsAsync(db);
            if (memberHosts.length > 1) {
                memberDbs = await openMemberClientsAsync(mongoDatabaseManager, memberHosts);
            }
        }

        try {
            // collStats + $indexStats (× members) are heavier than count/indexes, so bound
            // concurrency to avoid a load spike across the (100+) collections.
            const concurrency = includeSizes ? 4 : 25;
            const collection_stats = await async.mapLimit(
                Array.from(collection_names),
                concurrency,
                async (collection_name) => {
                    const isHistory = collection_name.includes('_History');
                    return await getStatsForCollectionAsync(
                        collection_name,
                        isHistory ? resourceHistoryDb : db,
                        includeSizes,
                        // history lives on a separate cluster; use single-node usage for it
                        isHistory ? [] : memberDbs
                    );
                }
            );
            const mongoConfig = await mongoDatabaseManager.getClientConfigAsync();
            /**
             * @type {Object}
             */
            const responseBody = {
                success: true,
                image: process.env.DOCKER_IMAGE || '',
                database: mongoConfig.db_name,
                collections: collection_stats
            };
            // only surface these in the heavy mode so the default response shape is unchanged
            if (includeSizes) {
                responseBody.sizesIncluded = true;
                // hosts queried for cross-member index usage ([] => single-node fallback)
                responseBody.indexUsageMemberHosts = memberDbs.map((m) => m.host);
            }
            res.status(200).json(responseBody);
        } finally {
            // always release the per-member connections
            await Promise.all(
                memberDbs.map(async (m) => {
                    try {
                        await mongoDatabaseManager.disconnectClientAsync(m.client);
                    } catch (error) {
                        logInfo(`Error closing member client ${m.host}: ${error.message}`, {});
                    }
                })
            );
        }
    } catch (error) {
        throw new RethrownError({
            error
        });
    }
};
