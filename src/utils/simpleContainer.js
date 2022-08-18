/**
 * Implements a very simple IoC (inversion of control) container
 * inspired by https://medium.com/@magnusjt/ioc-container-in-nodejs-e7aea8a89600
 */
class SimpleContainer {
    constructor() {
        this.services = {};
    }

    /**
     * Registers a new service in the IoC container
     * @param {string} name
     * @param {(SimpleContainer) => Object} cb
     * @return {SimpleContainer}
     */
    register(name, cb) {
        Object.defineProperty(this, name, {
            get: () => {
                if (!Object.hasOwn(this.services, name)) {
                    this.services[`${name}`] = cb(this);
                }

                return this.services[`${name}`];
            },
            configurable: true,
            enumerable: true
        });

        return this;
    }
}

module.exports = {
    SimpleContainer
};
