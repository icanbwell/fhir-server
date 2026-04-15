#!/usr/bin/env node
/**
 * Migrate Groups with member arrays from MongoDB to ClickHouse events
 * Run once during deployment to migrate existing data
 *
 * Usage:
 *   node src/scripts/migrate_mongodb_members_to_clickhouse.js [options]
 *
 * Options:
 *   --dry-run    Show what would be migrated without making changes
 *   --batch-size Size of batches for ClickHouse inserts (default: 10000)
 *   --limit      Limit number of Groups to migrate (for testing)
 *
 * Example:
 *   node src/scripts/migrate_mongodb_members_to_clickhouse.js --dry-run
 *   node src/scripts/migrate_mongodb_members_to_clickhouse.js --limit 10
 *   node src/scripts/migrate_mongodb_members_to_clickhouse.js
 */

const { MongoClient } = require('mongodb');
const { ClickHouseClientManager } = require('../utils/clickHouseClientManager');
const { ConfigManager } = require('../utils/configManager');

/**
 * Extract entity type from FHIR reference
 * Handles relative, absolute, and URN references
 *
 * @param {string} reference - FHIR reference
 * @returns {string} Entity type or 'Unknown'
 */
function extractEntityType(reference) {
    if (!reference || typeof reference !== 'string') {
        return 'Unknown';
    }

    // Absolute URL: http(s)://example.com/fhir/Patient/123 → Patient
    if (reference.startsWith('http://') || reference.startsWith('https://')) {
        const parts = reference.split('/');
        for (let i = parts.length - 2; i >= 0; i--) {
            if (parts[i] && parts[i] !== 'fhir') {
                return parts[i];
            }
        }
        return 'Unknown';
    }

    // URN reference: urn:uuid:... or urn:oid:... → Unknown (no resource type in URN)
    if (reference.startsWith('urn:')) {
        return 'Unknown';
    }

    // Relative reference: Patient/123 → Patient
    const firstSlash = reference.indexOf('/');
    if (firstSlash > 0) {
        return reference.substring(0, firstSlash);
    }

    // Fallback: entire reference is the type (unusual but handle gracefully)
    return reference;
}

/**
 * Convert ISO 8601 date to ClickHouse DateTime64 format
 * @param {string|null} isoDate - ISO 8601 date string or null
 * @returns {string|null} ClickHouse DateTime64 format or null
 */
function convertToClickHouseDateTime(isoDate) {
    if (!isoDate) return null;
    // Convert ISO 8601 (2024-01-01T00:00:00Z) to ClickHouse format (2024-01-01 00:00:00.000)
    return new Date(isoDate).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Parse command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        dryRun: false,
        batchSize: 10000,
        limit: null
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') {
            options.dryRun = true;
        } else if (args[i] === '--batch-size' && i + 1 < args.length) {
            options.batchSize = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--limit' && i + 1 < args.length) {
            options.limit = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: node migrate_mongodb_members_to_clickhouse.js [options]

Options:
  --dry-run           Show what would be migrated without making changes
  --batch-size <n>    Size of batches for ClickHouse inserts (default: 10000)
  --limit <n>         Limit number of Groups to migrate (for testing)
  --help, -h          Show this help message

Examples:
  node migrate_mongodb_members_to_clickhouse.js --dry-run
  node migrate_mongodb_members_to_clickhouse.js --limit 10
  node migrate_mongodb_members_to_clickhouse.js --batch-size 5000
            `);
            process.exit(0);
        }
    }

    return options;
}

/**
 * Main migration function
 */
async function migrateMongoDBMembersToClickHouse() {
    const options = parseArgs();

    console.log('========================================');
    console.log('MongoDB → ClickHouse Migration');
    console.log('========================================\n');
    console.log(`Dry run: ${options.dryRun ? 'YES (no changes)' : 'NO (will modify data)'}`);
    console.log(`Batch size: ${options.batchSize}`);
    console.log(`Limit: ${options.limit || 'None (all Groups)'}\n`);

    const configManager = new ConfigManager();
    const clickHouseManager = new ClickHouseClientManager({ configManager });

    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    const mongoClient = await MongoClient.connect(configManager.mongoUrl, {
        useUnifiedTopology: true
    });
    const db = mongoClient.db(configManager.dbName);
    const groupCollection = db.collection('Group_4_0_0');
    console.log('  ✓ Connected to MongoDB\n');

    // Connect to ClickHouse
    console.log('Connecting to ClickHouse...');
    await clickHouseManager.getClientAsync();
    console.log('  ✓ Connected to ClickHouse\n');

    console.log('Finding Groups with member arrays...');

    // Find all Groups that have a member array
    const query = { 'member.0': { $exists: true } }; // Has at least one member
    const queryOptions = {};
    if (options.limit) {
        queryOptions.limit = options.limit;
    }

    const groupsWithMembers = await groupCollection.find(query, queryOptions).toArray();

    console.log(`  ✓ Found ${groupsWithMembers.length} Groups with members\n`);

    if (groupsWithMembers.length === 0) {
        console.log('No Groups to migrate. Exiting.\n');
        await mongoClient.close();
        await clickHouseManager.closeAsync();
        return;
    }

    let totalMembersMigrated = 0;
    let groupsProcessed = 0;
    const BATCH_SIZE = options.batchSize;

    console.log('========================================');
    console.log('Processing Groups');
    console.log('========================================\n');

    for (const group of groupsWithMembers) {
        groupsProcessed++;
        console.log(`[${groupsProcessed}/${groupsWithMembers.length}] Group ${group.id}:`);
        console.log(`  Members: ${group.member.length}`);

        // Build 'added' events for all members
        const events = group.member.map(member => {
            const entityRef = member.entity.reference;
            // Convert datetime to ClickHouse format
            const eventTime = group.meta?.lastUpdated
                ? convertToClickHouseDateTime(group.meta.lastUpdated)
                : new Date().toISOString().replace('T', ' ').replace('Z', '');

            return {
                group_id: group.id,
                entity_reference: entityRef,
                entity_type: extractEntityType(entityRef),
                event_type: 'added',
                event_time: eventTime,
                period_start: convertToClickHouseDateTime(member.period?.start),
                period_end: convertToClickHouseDateTime(member.period?.end),
                inactive: member.inactive ? 1 : 0,
                group_source_id: group._sourceId || '',
                group_source_assigning_authority: group._sourceAssigningAuthority || '',
                access_tags: group.meta?.security?.filter(s => s.system?.includes('access')).map(s => s.code) || [],
                owner_tags: group.meta?.security?.filter(s => s.system?.includes('owner')).map(s => s.code) || []
            };
        });

        if (!options.dryRun) {
            // Insert in batches to ClickHouse
            for (let i = 0; i < events.length; i += BATCH_SIZE) {
                const batch = events.slice(i, i + BATCH_SIZE);
                await clickHouseManager.insertAsync({
                    table: 'fhir.Group_4_0_0_MemberEvents',
                    values: batch,
                    format: 'JSONEachRow'
                });
                console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} events)`);
            }

            // Remove member array from MongoDB (keep metadata only)
            await groupCollection.updateOne(
                { id: group.id },
                {
                    $unset: { member: '' },
                    $set: {
                        // Don't set quantity here - computed on-read from ClickHouse
                        'meta.lastUpdated': new Date().toISOString()
                    }
                }
            );

            console.log(`  ✓ Migrated ${events.length} members, removed array from MongoDB`);
        } else {
            console.log(`  [DRY RUN] Would migrate ${events.length} members`);
        }

        totalMembersMigrated += events.length;
        console.log('');
    }

    console.log('========================================');
    console.log('Migration Summary');
    console.log('========================================\n');
    console.log(`Groups processed: ${groupsProcessed}`);
    console.log(`Total members: ${totalMembersMigrated}`);
    console.log(`Mode: ${options.dryRun ? 'DRY RUN (no changes made)' : 'LIVE (data migrated)'}\n`);

    if (!options.dryRun) {
        console.log('Verifying migration...\n');

        // Verify ClickHouse has the events
        const eventCount = await clickHouseManager.queryAsync({
            query: 'SELECT COUNT(*) as count FROM Group_4_0_0_MemberEvents'
        });
        console.log(`  ClickHouse total events: ${eventCount[0].count}`);

        // Verify MongoDB no longer has member arrays
        const remainingGroups = await groupCollection.find({
            'member.0': { $exists: true }
        }).count();
        console.log(`  MongoDB Groups with member arrays: ${remainingGroups}`);

        if (remainingGroups === 0) {
            console.log('\n  ✅ Migration successful!\n');
        } else {
            console.log(`\n  ⚠️  Warning: ${remainingGroups} Groups still have member arrays in MongoDB\n`);
        }
    } else {
        console.log('Run without --dry-run to perform actual migration.\n');
    }

    await mongoClient.close();
    await clickHouseManager.closeAsync();
}

// Run migration
migrateMongoDBMembersToClickHouse()
    .then(() => {
        console.log('Migration script completed.');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    });
