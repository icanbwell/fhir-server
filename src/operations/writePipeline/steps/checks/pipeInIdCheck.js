const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');

/**
 * A precheck for the `findExisting` step, per item: fails an item whose id contains a pipe (`|`) at
 * the `IDENTITY` stage.
 */
class PipeInIdCheck {
    /**
     * The stage this check's failures use, and the one used if it throws: `IDENTITY`.
     * @returns {string}
     */
    get stage () {
        return WRITE_FAILURE_STAGE.IDENTITY;
    }

    /**
     * Returns a failure carrying an error if the id is a string that contains `|`, otherwise null.
     * @param {WriteItem} item
     * @returns {Promise<WriteFailure|null>}
     */
    async checkAsync ({ item }) {
        if (typeof item.incoming.id !== 'string' || !item.incoming.id.includes('|')) {
            return null;
        }
        return new WriteFailure({
            stage: this.stage,
            subject: WriteFailure.subjectOf(item.incoming),
            error: new Error('Pipe | is not allowed in id field')
        });
    }
}

module.exports = {
    PipeInIdCheck
};
