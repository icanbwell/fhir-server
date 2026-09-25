/**
 * Uploads sample-resources.ndjson to S3 at <clientSlug>/<taskId>/sample-resources.ndjson.
 *
 * Usage:
 *   node scripts/uploadClaimsToS3.js --clientSlug <clientSlug> --taskId <taskId>
 *
 * Requires AWS credentials to be available via the standard SDK credential
 * chain (env vars, shared config/credentials file, or an assumed role).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = 'bwell-dev-use1-aws-pdex-bulk-export';
const FILE = path.join(__dirname, '..', 'sample-resources.ndjson');

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--clientSlug') {
            args.clientSlug = argv[++i];
        } else if (arg === '--taskId') {
            args.taskId = argv[++i];
        }
    }
    return args;
}

async function main() {
    const { clientSlug, taskId } = parseArgs(process.argv.slice(2));

    if (!clientSlug || !taskId) {
        console.error('Usage: node scripts/uploadClaimsToS3.js --clientSlug <clientSlug> --taskId <taskId>');
        process.exit(1);
    }

    if (!fs.existsSync(FILE)) {
        console.error(`File not found: ${FILE}`);
        process.exit(1);
    }

    const key = `${clientSlug}/${taskId}/${path.basename(FILE)}`;
    const client = new S3Client({});

    await client.send(
        new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: fs.createReadStream(FILE),
            ContentType: 'application/x-ndjson',
        })
    );

    console.log(`Uploaded ${FILE} to s3://${BUCKET}/${key}`);
}

main().catch((err) => {
    console.error('Upload failed:', err);
    process.exit(1);
});
