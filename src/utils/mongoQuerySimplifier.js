const {removeDuplicatesWithLambda} = require('./list.util');

class MongoQuerySimplifier {
    /**
     * simplifies the filter by removing duplicate segments and $or statements with just one child
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} filter
     * @return {import('mongodb').Filter<import('mongodb').DefaultSchema>}
     */
    static simplifyFilter({filter}) {
        // simplify $or
        if (filter.$or && filter.$or.length > 1) {
            filter.$or = removeDuplicatesWithLambda(filter.$or,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$or && filter.$or.length > 0) {
            filter.$or = filter.$or.map(f => this.simplifyFilter({filter: f}));
            const indexesToSplice = [];
            for (const [subFilterIndex, subFilter] of filter.$or.entries()) {
                if (this.isFilter(subFilter) && subFilter.$or) {
                    const andFilters = subFilter.$or;
                    // eslint-disable-next-line no-loop-func
                    andFilters.forEach(af => filter.$or.push(af));
                    indexesToSplice.push(subFilterIndex);
                }
            }
            if (indexesToSplice.length > 0) {
                filter.$or = filter.$or.filter((item, index) => !indexesToSplice.includes(index));
            }

        }
        if (filter.$or && filter.$or.length === 1) {
            filter = filter.$or[0];
        }
        // simplify $nor
        if (filter.$nor && filter.$nor.length > 1) {
            filter.$nor = removeDuplicatesWithLambda(filter.$nor,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$nor && filter.$nor.length > 0) {
            filter.$nor = filter.$nor.map(f => this.simplifyFilter({filter: f}));
        }
        // simplify $and
        if (filter.$and && filter.$and.length > 1) {
            filter.$and = removeDuplicatesWithLambda(filter.$and,
                (a, b) => JSON.stringify(a) === JSON.stringify(b)
            );
        }
        if (filter.$and && filter.$and.length > 0) {
            filter.$and = filter.$and.map(f => this.simplifyFilter({filter: f}));
            const indexesToSplice = [];
            for (const [subFilterIndex, subFilter] of filter.$and.entries()) {
                if (this.isFilter(subFilter) && subFilter.$and) {
                    const andFilters = subFilter.$and;
                    // eslint-disable-next-line no-loop-func
                    andFilters.forEach(af => filter.$and.push(af));
                    indexesToSplice.push(subFilterIndex);
                }
            }
            if (indexesToSplice.length > 0) {
                filter.$and = filter.$and.filter((item, index) => !indexesToSplice.includes(index));
            }
        }
        // if there are $and filters inside this $and then promote them to the same level
        if (filter.$and && filter.$and.length === 1) {
            filter = filter.$and[0];
        }
        // simplify $in
        if (filter.$in && filter.$in.length === 1) {
            filter = filter.$in[0];
        }

        for (const [key, value] of Object.entries(filter)) {
            if (!['$and', '$in', '$or', '$nor'].includes(key) && value) {
                if (this.isFilter(value)) {
                    filter[`${key}`] = this.simplifyFilter({filter: value});
                }
            }
        }

        return filter;
    }

    /**
     * Returns whether value is a filter
     * @param {*} value
     * @return {boolean}
     */
    static isFilter(value) {
        return !Array.isArray(value) && typeof value === 'object';
    }
}

module.exports = {
    MongoQuerySimplifier
};
