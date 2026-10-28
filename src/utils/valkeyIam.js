const { SignatureV4 } = require('@smithy/signature-v4');
const { HttpRequest } = require('@smithy/protocol-http');
const { Sha256 } = require('@aws-crypto/sha256-js');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

// <cache-name>-<6 char id>.serverless.<region>.cache.amazonaws.com
const SERVERLESS_HOST = /^([^.]+)\.serverless\.[a-z0-9-]+\.cache\.amazonaws\.com$/;
const TOKEN_TTL_SECONDS = 900;

/**
 * AWS ElastiCache Serverless (Valkey) settings when VALKEY_HOST is set, otherwise undefined
 * (keep using Redis Cloud).
 * @param {NodeJS.ProcessEnv} env
 * @returns {{host: string, port: number, username: string, region: string}|undefined}
 */
function getValkeyConfig(env) {
    if (!env.VALKEY_HOST) {
        return undefined;
    }
    if (!env.VALKEY_IAM_USERNAME) {
        throw new Error('VALKEY_IAM_USERNAME is required when VALKEY_HOST is set');
    }
    return {
        host: env.VALKEY_HOST,
        port: parseInt(env.VALKEY_PORT) || 6379,
        username: env.VALKEY_IAM_USERNAME,
        region: env.VALKEY_IAM_REGION || 'us-east-1'
    };
}

/**
 * Signs a short-lived (15 minute) ElastiCache IAM auth token, used as the password of the Valkey user.
 * Serverless tokens are signed for the cache name (not the endpoint host) with ResourceType=ServerlessCache.
 * @param {{host: string, username: string, region: string}} config
 * @returns {Promise<string>}
 */
async function generateValkeyIamToken(config) {
    const match = SERVERLESS_HOST.exec(config.host);
    const cacheName = match ? match[1].replace(/-[a-z0-9]{6}$/, '') : config.host;

    const signer = new SignatureV4({
        service: 'elasticache',
        region: config.region,
        credentials: defaultProvider(),
        sha256: Sha256
    });
    const request = new HttpRequest({
        method: 'GET',
        protocol: 'https:',
        hostname: cacheName,
        path: '/',
        query: {
            Action: 'connect',
            User: config.username,
            ...(match ? { ResourceType: 'ServerlessCache' } : {})
        },
        headers: { host: cacheName }
    });
    const presigned = await signer.presign(request, { expiresIn: TOKEN_TTL_SECONDS });
    const queryString = Object.entries(presigned.query ?? {})
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    return `${cacheName}/?${queryString}`;
}

/**
 * node-redis credentials provider that signs a fresh IAM token every time the client connects.
 * @param {{host: string, username: string, region: string}} config
 */
function valkeyCredentialsProvider(config) {
    return {
        type: 'async-credentials-provider',
        credentials: async () => ({
            username: config.username,
            password: await generateValkeyIamToken(config)
        })
    };
}

module.exports = { getValkeyConfig, generateValkeyIamToken, valkeyCredentialsProvider };
