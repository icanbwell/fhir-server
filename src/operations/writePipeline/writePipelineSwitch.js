const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Answers from `WRITE_PIPELINE_OPERATIONS`, the operations whose entry point should use the shared
 * write pipeline instead of its old path. It reads the list through `ConfigManager`, which reads
 * the variable on every call.
 */
class WritePipelineSwitch {
    /**
     * The operation names `WRITE_PIPELINE_OPERATIONS` may list.
     */
    static OPERATIONS = Object.freeze(['create', 'update', 'patch', 'merge', 'import', 'admin']);

    /**
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Throws if `WRITE_PIPELINE_OPERATIONS` lists an operation that is not in `OPERATIONS`. The app
     * calls it at startup.
     * @returns {void}
     */
    assertValidConfiguration () {
        const unknownOperations = this.configManager.writePipelineOperations.filter(
            (operation) => !WritePipelineSwitch.OPERATIONS.includes(operation)
        );
        if (unknownOperations.length > 0) {
            throw new Error(
                `WRITE_PIPELINE_OPERATIONS has unknown operation(s): ${unknownOperations.join(', ')}. ` +
                `Allowed: ${WritePipelineSwitch.OPERATIONS.join(', ')}`
            );
        }
    }

    /**
     * Returns whether `WRITE_PIPELINE_OPERATIONS` lists the operation. An operation's entry point
     * calls it to choose between the write pipeline and its old path.
     * @param {string} operation
     * @returns {boolean}
     */
    useNewPathFor (operation) {
        return this.configManager.writePipelineOperations.includes(operation);
    }
}

module.exports = {
    WritePipelineSwitch
};
