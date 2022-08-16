/**
 * inspired by https://medium.com/@magnusjt/ioc-container-in-nodejs-e7aea8a89600
 */
class SimpleContainer {
    constructor() {
        this.services = {};
    }

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
