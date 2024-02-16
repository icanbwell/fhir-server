const { open } = require('node:fs/promises');
const { DelinkProaPersonRunner } = require('./delinkProaPersonRunner');

class DelinkProaPersonMasterPersonRunner extends DelinkProaPersonRunner {
    /**
     * @typedef {Object} ConstructorProps
     * @property {any} args
     * @property {number} masterPersonSAAColumn
     * @property {number} masterPersonLastUpdatedColumn
     *
     * @param {ConstructorProps}
     */
    constructor({ masterPersonSAAColumn, masterPersonLastUpdatedColumn, ...args }) {
        super(args);

        /**
         * @type {number}
         */
        this.masterPersonSAAColumn = masterPersonSAAColumn;

        /**
         * @type {number}
         */
        this.masterPersonLastUpdatedColumn = masterPersonLastUpdatedColumn;

        /**
         * @type {string[]}
         */
        this.statusToConsider = [
            'Proa Person not linked to master person',
            'Master Person Not Linked to Client Person and Master Patient',
        ];
    }
    /**
     * Processes data from the csv and creates map of proaPatient, proaPerson, masterPerson, clientPerson, status
     * @returns {Promise<void>}
     */
    async processDataFromCsv() {
        // No need for data processing
    }

    /**
     * Handles Delinking of proa person and master person
     * @returns {Promise<void>}
     */
    async handleDelink() {
        // No need for delinking here we can directly delete the data if all references
        // are to be deleted else we donot change the data
    }

    /**
     * Handle deletion of person
     * @returns {Promise<void>}
     */
    async handlePersonDelete() {
        this.adminLogger.logInfo('Starting first iteration to delete proa persons');

        let file = await open(this.csvFileName);
        for await (const line of file.readLines()) {
            /**
             * @type {string[]}
             */
            const columns = line.split('| ');

            const proaPatientUuid = columns[this.proaPatientUuidColumn];
            if (proaPatientUuid.includes('Proa')) {
                continue;
            }
            const proaPersonUuids = columns[this.proaPersonUuidColumn].split(', ');
            const masterPersonUuids = columns[this.masterUuidColumn].split(', ');
            let statuses = columns[this.statusColumn].split(', ').map(s => s.replace('|', ''));

            if (statuses.length === 1 && statuses[0] === 'Proa Patient linked to multiple Proa Persons') {
                statuses = proaPersonUuids.map(() => 'Proa Person not linked to master person');
            }

            statuses = statuses.filter(s => s !== '');

            const isProaPersonStatus = statuses.every(
                status => status === 'Proa Person with Valid Master Person' ||
                    status === 'Proa Person not linked to master person'
            );
            const isMasterPersonStatus = statuses.every(
                status => status === 'Proa Person not linked to master person' || (
                    (
                        status.includes('Client Person') ||
                        status.includes('Master Patient')
                    ) &&
                    !status.includes('Client Patient')
                )
            );

            if (isProaPersonStatus) {
                const proaPersonSAAs = columns[this.proaPersonSAAColumn].split(', ');
                const proaPersonLastUpdated = columns[this.proaPersonLastUpdatedColumn].split(', ');

                for (let i = 0; i < proaPersonUuids.length; i++) {
                    const proaPersonUuid = proaPersonUuids[`${i}`];
                    const sourceAssigningAuthority = proaPersonSAAs[`${i}`];
                    const lastUpdated = proaPersonLastUpdated[`${i}`];
                    const status = statuses[`${i}`];

                    if (this.statusToConsider.includes(status)) {
                        await this.deletePerson({
                            referencesToBeDeleted: [`Patient/${proaPatientUuid}`],
                            personUuid: proaPersonUuid,
                            sourceAssigningAuthority,
                            lastUpdated,
                            slug: 'Proa',
                        });
                    }
                }
            } else if (isMasterPersonStatus) {
                const masterPersonSAAs = columns[this.masterPersonSAAColumn].split(', ');
                const masterPersonLastUpdated = columns[this.masterPersonLastUpdatedColumn].split(', ');

                for (let i = 0; i < masterPersonUuids.length; i++) {
                    const masterPersonUuid = masterPersonUuids[`${i}`];
                    const sourceAssigningAuthority = masterPersonSAAs[`${i}`];
                    const lastUpdated = masterPersonLastUpdated[`${i}`];
                    const status = statuses[`${i}`];

                    if (this.statusToConsider.includes(status) && masterPersonUuid !== 'null') {
                        await this.deletePerson({
                            referencesToBeDeleted: proaPersonUuids.map(u => `Person/${u}`),
                            personUuid: masterPersonUuid,
                            sourceAssigningAuthority,
                            lastUpdated,
                            slug: 'Master',
                        });
                    }
                }
            }
        }
        this.adminLogger.logInfo('First iteration finished');
    }
}

module.exports = { DelinkProaPersonMasterPersonRunner };
