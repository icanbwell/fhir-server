const async = require('async');
const { validateResource } = require('../../utils/validator.util');
const { validationsFailedCounter } = require('../../utils/prometheus.utils');
const sendToS3 = require('../../utils/aws-s3');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');
const { getCircularReplacer } = require('../../utils/getCircularReplacer');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { RemoteFhirValidator } = require('../../utils/remoteFhirValidator');
const OperationOutcome = require('../../fhir/classes/4_0_0/resources/operationOutcome');
const OperationOutcomeIssue = require('../../fhir/classes/4_0_0/backbone_elements/operationOutcomeIssue');
const CodeableConcept = require('../../fhir/classes/4_0_0/complex_types/codeableConcept');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { VERSIONS } = require('../../middleware/fhir/utils/constants');
const { ScopesManager } = require('../security/scopesManager');
const { DatabaseUpdateFactory } = require('../../dataLayer/databaseUpdateFactory');
const StructureDefinition = require('../../fhir/classes/4_0_0/resources/structureDefinition');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const Meta = require('../../fhir/classes/4_0_0/complex_types/meta');
const Coding = require('../../fhir/classes/4_0_0/complex_types/coding');
const { BadRequestError } = require('../../utils/httpErrors');
const { logError } = require('./logging');
const { RethrownError } = require('../../utils/rethrownError');
const { isColumnDateType } = require('./isColumnDateType');

class ResourceValidator {
    /**
     * constructor
     * @param {ConfigManager} configManager
     * @param {RemoteFhirValidator} remoteFhirValidator
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {DatabaseUpdateFactory} databaseUpdateFactory
     * @param {ScopesManager} scopesManager
     */
    constructor (
        {
            configManager,
            remoteFhirValidator,
            databaseQueryFactory,
            databaseUpdateFactory,
            scopesManager
        }
    ) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * @type {RemoteFhirValidator}
         */
        this.remoteFhirValidator = remoteFhirValidator;
        assertTypeEquals(remoteFhirValidator, RemoteFhirValidator);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {DatabaseUpdateFactory}
         */
        this.databaseUpdateFactory = databaseUpdateFactory;
        assertTypeEquals(databaseUpdateFactory, DatabaseUpdateFactory);

        /**
         * @type {ScopesManager}
         */
        this.scopesManager = scopesManager;
        assertTypeEquals(scopesManager, ScopesManager);
    }

    /**
     * validates a resource
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {string} id
     * @param {string} resourceType
     * @param {Object|Resource} resourceToValidate
     * @param {string} path
     * @param {string} currentDate
     * @param {Object} resourceObj
     * @param {boolean|undefined} useRemoteFhirValidatorIfAvailable
     * @param {string|undefined} profile
     * @returns {Promise<OperationOutcome | null>}
     */
    async validateResourceAsync (
        {
            base_version,
            requestInfo,
            id,
            resourceType,
            resourceToValidate,
            path,
            currentDate,
            resourceObj = null,
            useRemoteFhirValidatorIfAvailable = false,
            profile
        }
    ) {
        const resourceToValidateJson = (resourceToValidate instanceof Resource) ? resourceToValidate.toJSON() : resourceToValidate;
        delete resourceToValidateJson?.meta?.lastUpdated;

        // Convert date fields to string for validation
        for (const [fieldName, field] of Object.entries(resourceToValidateJson)) {
            if (isColumnDateType(resourceToValidateJson.resourceType, fieldName)) {
                if (field instanceof Date && field) {
                    resourceToValidateJson[`${fieldName}`] = field.toISOString();
                }
            }
        }
        /**
         * @type {OperationOutcome | null}
         */
        const validationOperationOutcome = this.configManager.fhirValidationUrl && useRemoteFhirValidatorIfAvailable
            ? await this.validateResourceFromServerAsync(
                {
                    base_version,
                    requestInfo,
                    resourceBody: resourceToValidateJson,
                    resourceName: resourceType,
                    path,
                    resourceObj,
                    profile
                }
            ) : validateResource(
                {
                    resourceBody: resourceToValidateJson,
                    resourceName: resourceType,
                    path,
                    resourceObj
                }
            );
        if (validationOperationOutcome) {
            validationsFailedCounter.inc({ action: 'validate', resourceType }, 1);
            validationOperationOutcome.expression = [
                resourceType + '/' + id
            ];
            if (!(validationOperationOutcome.details) || !(validationOperationOutcome.details.text)) {
                validationOperationOutcome.details = {
                    text: JSON.stringify(resourceToValidateJson, getCircularReplacer())
                };
            } else {
                validationOperationOutcome.details.text = validationOperationOutcome.details.text +
                    ',' + JSON.stringify(resourceToValidateJson, getCircularReplacer());
            }

            if (this.configManager.logValidationFailures) {
                await sendToS3('validation_failures',
                    resourceType,
                    resourceToValidateJson,
                    currentDate,
                    id,
                    'merge');
                await sendToS3('validation_failures',
                    resourceType,
                    validationOperationOutcome,
                    currentDate,
                    id,
                    'merge_failure');
            }
            return validationOperationOutcome;
        }
        return null;
    }

    /**
     * Validate meta of a resource
     * @param {Object|Resource} resource
     * @returns {OperationOutcome|null} Response<null|OperationOutcome> - either null if no errors or response to send client.
     */
    validateResourceMetaSync (resource) {
        // Check if meta & meta.source exists in resource
        if (this.configManager.requireMetaSourceTags && (!resource.meta || !resource.meta.source)) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: 'Unable to create/update resource. Missing either metadata or metadata source.'
                        })
                    })
                ]
            });
        }

        // Check owner tag is present inside the resource.
        if (!this.scopesManager.doesResourceHaveOwnerTags(resource)) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Resource ${resource.resourceType}/${resource.id}` +
                                ' is missing a security access tag with system: ' +
                                `${SecurityTagSystem.owner}`
                        })
                    })
                ]
            });
        }

        // Check if multiple owner tags are present inside the resource.
        if (this.scopesManager.doesResourceHaveMultipleOwnerTags(resource)) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Resource ${resource.resourceType}/${resource.id}` +
                                ' is having multiple security access tag with system: ' +
                                `${SecurityTagSystem.owner}`
                        })
                    })
                ]
            });
        }
        // Check if any system or code in the meta.security array is null
        if (this.scopesManager.doesResourceHaveInvalidMetaSecurity(resource)) {
            return new OperationOutcome({
                issue: [
                    new OperationOutcomeIssue({
                        severity: 'error',
                        code: 'invalid',
                        details: new CodeableConcept({
                            text: `Resource ${resource.resourceType}/${resource.id}` +
                                ' has null/empty value for \'system\' or \'code\' in security access tag.'
                        })
                    })
                ]
            });
        }
    }

    /**
     * @function validateResourceFromServerAsync
     * @description - validates name is correct for resource body and resource body conforms to FHIR specification
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} resourceBody - payload of req.body
     * @param {string} resourceName - name of resource in url
     * @param {string} path - req.path from express
     * @param {Object} resourceObj - fhir resource object
     * @param {string|undefined} profile
     * @returns {OperationOutcome|null} Response<null|OperationOutcome> - either null if no errors or response to send client.
     */
    async validateResourceFromServerAsync (
        {
            base_version,
            requestInfo,
            resourceBody,
            resourceName,
            path,
            resourceObj = null,
            profile
        }) {
        const resourceToValidateJson = (resourceBody instanceof Resource) ? resourceBody.toJSON() : resourceBody;

        if (profile) {
            // save profile in remote server
            await this.upsertProfileInRemoteServer({ base_version, requestInfo, profile });
        }

        // upsert profiles contained in metaProfiles
        if (resourceToValidateJson.meta && resourceToValidateJson.meta.profile && resourceToValidateJson.meta.profile.length > 0) {
            /**
             * @type {string[]}
             */
            const metaProfiles = resourceToValidateJson.meta.profile;
            await this.upsertProfileInRemoteServer({ base_version, requestInfo, profile: metaProfiles, resourceType: resourceToValidateJson.resourceType });
        }

        /**
         * @type {OperationOutcome|null}
         */
        const operationOutcome = await this.remoteFhirValidator.validateResourceAsync(
            {
                resourceBody: resourceToValidateJson,
                resourceName,
                path,
                resourceObj,
                profile
            }
        );
        if (operationOutcome && operationOutcome.issue && operationOutcome.issue.length > 0) {
            // remove any warnings avoid noise
            operationOutcome.issue = operationOutcome.issue.filter(issue => issue.severity === 'error');
        }
        if (!operationOutcome.issue || operationOutcome.issue.length === 0) {
            operationOutcome.issue = new OperationOutcomeIssue({
                code: 'informational',
                details: {
                    text: 'OK'
                },
                expression: [
                    'Practitioner'
                ],
                severity: 'information'
            });
        }
        return operationOutcome;
    }

    /**
     * Fetch profiles from database. If not exists, fetch it from fhirRemoveValidator and
     * then save it to Database.
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {{ profile: string | string[], resourceType?: string}} options
     * @throws {BadRequestError} Error if not able to fetch profile from remote url
     */
    async upsertProfileInRemoteServer ({ base_version, requestInfo, profile, resourceType }) {
        // convert to array
        const profiles = Array.isArray(profile) ? profile : [profile];
        const profilesToFetchFromRemote = new Set(profiles);
        const concurrencyLimit = this.configManager.batchSizeForRemoteFhir;

        const profileJsonToUpdate = [];
        /**
         * Upsert profile in HAPI Fhir
         */
        const updateRemoteFhirProfileTask = async ({ profileJson }) => {
            try {
                await this.remoteFhirValidator.updateProfileAsync({ profileJson });
            } catch (error) {
                logError(
                    `Error occurred while updating profile in hapi server with id: '${profileJson.id}'`,
                    {
                        source: 'ResourceValidator.saveProfileIfNotExist',
                        args: {
                            error,
                            message: error.message,
                            profileId: profileJson.id
                        }
                    }
                );

                throw new RethrownError({
                    error,
                    source: 'ResourceValidator.updateRemoteFhirProfileTask',
                    args: {
                        profileJson
                    }
                });
            }
        };

        const databaseUpdateManager = this.databaseUpdateFactory.createDatabaseUpdateManager({
            resourceType: 'StructureDefinition',
            base_version: VERSIONS['4_0_0']
        });

        /**
         * @type {{ location: string, profile: string }[]}
         */
        const invalidProfileUrls = [];
        const fetchProfileFromUrl = async ({ profileUrl, index }) => {
            /**
             * @type {{[k: string]: any} | null}
             */
            const profileJson = await this.remoteFhirValidator
                .fetchProfileAsync({ url: profileUrl })
                .catch((error) => {
                    if (error.response && error.response.status === 404) {
                        // push error if 404
                        if (resourceType) {
                            invalidProfileUrls.push({
                                location: `${resourceType}.meta.profile[${index}]`,
                                profile: profileUrl
                            });
                        } else {
                            invalidProfileUrls.push({
                                location: 'profile',
                                profile: profileUrl
                            });
                        }

                        return null;
                    } else {
                        throw error;
                    }
                });

            if (profileJson) {
                const profileResourceNew = this.createProfileResourceFromJson({ profileJson });
                await databaseUpdateManager.replaceOneAsync({
                    base_version,
                    requestInfo,
                    doc: profileResourceNew
                });

                profileJsonToUpdate.push({ profileJson: profileResourceNew.toJSON(), profileUrl });
            }
        };

        /**
         * @type {import('../../dataLayer/databaseQueryManager').DatabaseQueryManager}
         */
        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: 'StructureDefinition',
            base_version: VERSIONS['4_0_0']
        });

        // check if profile already exist in database
        const cursor = await databaseQueryManager.findAsync({
            query: { url: { $in: profiles } }
        });

        while (await cursor.hasNext()) {
            /**
             * @type {Resource}
             */
            const profileJson = await cursor.next();
            const profileUrl = profileJson.url;
            profileJsonToUpdate.push({ profileJson: profileJson.toJSON(), profileUrl });
            profilesToFetchFromRemote.delete(profileUrl);
        }

        // resourceType is present, means profiles are present in resource
        const defaultErrorMessage = resourceType ? 'Unable to fetch profile details for resource at' : 'Unable to fetch profile details from passed param';

        // concurrently load the profiles form their url
        await async.eachLimit(
            Array.from(profilesToFetchFromRemote).map((p, index) => ({ profileUrl: p, index })),
            concurrencyLimit,
            fetchProfileFromUrl
        );

        // if 404 returns while fetching profile, send those in response
        if (invalidProfileUrls.length > 0) {
            const errMsg = `${defaultErrorMessage} ${invalidProfileUrls
                .map((v) => `${v.location} = '${v.profile}'`)
                .join(', ')}`;
            throw new BadRequestError(new Error(errMsg));
        }

        // update fhir remote server
        await async.eachLimit(profileJsonToUpdate, concurrencyLimit, updateRemoteFhirProfileTask);
    }

    /**
     * Create structure definition from given profile json
     * @param {{ profileJson: Record<string, any>}} params
     * @returns {StructureDefinition}
     */
    createProfileResourceFromJson ({ profileJson }) {
        const profileResourceNew = new StructureDefinition(profileJson);
        if (!profileResourceNew.meta) {
            profileResourceNew.meta = new Meta({});
        }
        if (profileResourceNew.meta.security) {
            profileResourceNew.meta.security.push(
                new Coding({
                    system: SecurityTagSystem.owner,
                    code: profileResourceNew.publisher || 'profile'
                })
            );
        } else {
            profileResourceNew.meta.security = [
                new Coding({
                    system: SecurityTagSystem.owner,
                    code: profileResourceNew.publisher || 'profile'
                })
            ];
        }
        if (!profileResourceNew.meta.source) {
            profileResourceNew.meta.source = profileResourceNew.url;
        }

        return profileResourceNew;
    }
}

module.exports = {
    ResourceValidator
};
