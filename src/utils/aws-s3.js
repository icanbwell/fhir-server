/**
 * This file implements helper functions for AWS
 */

const { S3 } = require('@aws-sdk/client-s3');
const { STS } = require('@aws-sdk/client-sts');
const {
    getLogger
} = require('../winstonInit');

/**
 * @type {import('winston').logger}
 */
const logger = getLogger();
const moment = require('moment-timezone');

const AWS_BUCKET = process.env.AWS_BUCKET;
const REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_FOLDER = process.env.AWS_FOLDER;

const s3 = new S3({
    region: REGION
});

/**
 * @function sendToS3
 * @description In case of FHIR Server failure, dump form body to S3
 * @param prefix
 * @param resourceType
 * @param {*} resource - parsed form body
 * @param currentDate
 * @param {*} id - first name for key
 * @param filename_postfix - Optional postfix for filename
 * @return {Promise<data|err>}
 */
module.exports = async function sendToS3 (prefix, resourceType, resource, currentDate, id, filename_postfix) {
    if (!AWS_BUCKET) {
        return Promise.resolve(null);
    }
    const currentTime = moment.utc().format('HH-mm-ss');
    const randomString = Math.random().toString(36).substring(0, 5);
    const key = `${AWS_FOLDER}/${prefix}/${resourceType}/${currentDate}/${id}/${currentTime}-${filename_postfix}-${randomString}.json`;
        try {
        const params = {
            Body: JSON.stringify(resource),
            Bucket: AWS_BUCKET,
            Key: key,
            ContentType: 'application/json',
            ServerSideEncryption: 'AES256'
        };

// Using async/await with promise support
        try {
            const data = await s3.putObject(params);
            logger.info('[AWS-S3] Successfully placed object in bucket' + AWS_BUCKET + ': ' + key);
            return data;
        } catch (err) {
            // If putObject fails, log the error and attempt to getCallerIdentity
            const sts = new STS({});
            try {
                const role_data = await sts.getCallerIdentity({});
                logger.error('[AWS-S3] Failed to put object: ' +
                    key + ' in bucket: ' + AWS_BUCKET + ': ' + key + ' with user: ' + JSON.stringify(role_data));
            } catch (_error) {
                // Log the original putObject error if getCallerIdentity also fails
                logger.error('[AWS-S3] Object: ', JSON.stringify(resource));
                logger.error('[AWS-S3] Error: ' + key + ':', _error);
            }
            throw err; // Rethrow the original error after logging
        }
    } catch (e) {
        logger.error('[AWS-S3] Error to put object: ' +
            key + ' in bucket: ' + AWS_BUCKET + ': ' + key + '. Error=' + e);
        throw e; // Rethrow the error to be caught by the caller
    }
};
