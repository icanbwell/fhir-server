const {GenericController} = require('./4_0_0/controllers/generic.controller');
const {assertTypeEquals} = require('../../utils/assertType');

class ControllerUtils {
    /**
     * constructor
     * @param {GenericController} genericController
     */
    constructor({genericController}) {
        assertTypeEquals(genericController, GenericController);
        /**
         * @type {GenericController}
         */
        this.genericController = genericController;
    }
    /**
     *
     * @param {string} version
     * @param {string} resourceName
     */
    // eslint-disable-next-line no-unused-vars
    getController(version, resourceName) {
        switch (version) {
            case '4_0_0':
                return this.genericController;
        }
    }
}

module.exports = {
    ControllerUtils
};
