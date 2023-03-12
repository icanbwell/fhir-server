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
        // remove nested $or if there is a parent $or
        if (filter.$or && filter.$or.length > 0) {
            filter.$or = filter.$or.map(f => this.simplifyFilter({filter: f}));
            const indexesToSplice = [];
            for (const [subFilterIndex, subFilter] of filter.$or.entries()) {
                if (this.isFilter(subFilter) && subFilter.$or) {
                    const orFilters = subFilter.$or;
                    // eslint-disable-next-line no-loop-func
                    orFilters.forEach(af => filter.$or.push(af));
                    indexesToSplice.push(subFilterIndex);
                }
            }
            if (indexesToSplice.length > 0) {
                filter.$or = filter.$or.filter((item, index) => !indexesToSplice.includes(index));
            }
            let key = null;
            let allKeysAreSame = true;
            const valuesInSubFilters = [];
            // Turn $or into $in if all the field names are same and the filters are strings
            for (const subFilter of filter.$or) {
                if (subFilter && this.isFilter(subFilter)) {
                    const keysForSubFilter = Object.keys(subFilter);
                    if (!key && keysForSubFilter.length > 0) {
                        key = keysForSubFilter[0];
                    }
                    if (key === keysForSubFilter[0] && typeof subFilter[keysForSubFilter[0]] === 'string') {
                        valuesInSubFilters.push(subFilter[keysForSubFilter[0]]);
                    } else {
                        allKeysAreSame = false;
                        break;
                    }
                }
            }
            if (allKeysAreSame && valuesInSubFilters.length > 0) {
                // convert to an $in filter
                filter = {
                    [key]: {
                        $in: valuesInSubFilters
                    }
                };
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

    /**
     * finds all columns being used in the filter
     * @param {string|undefined} [parentKey]
     * @param {import('mongodb').Filter<import('mongodb').DefaultSchema>} filter
     * @return {Set<string>}
     */
    static findColumnsInFilter({parentKey, filter}) {
        const columns = new Set();
        if (!this.isFilter(filter)) {
            return columns;
        }
        const parentColumns = new Set();
        const columnsForChildren = new Set();
        for (const [operator, subFilter] of Object.entries(filter)) {
            let newParentKey = parentKey;

            if (!operator.startsWith('$')) {
                if (parentKey) {
                    newParentKey = `${parentKey}.${operator}`;
                } else {
                    newParentKey = operator;
                }
                parentColumns.add(newParentKey);
            }
            if (Array.isArray(subFilter)) {
                const newColumns = subFilter.flatMap(
                    // eslint-disable-next-line no-loop-func
                    sf => Array.from(
                        this.findColumnsInFilter(
                            {
                                parentKey: newParentKey,
                                filter: sf
                            }
                        )
                    )
                );
                newColumns.forEach(c => columnsForChildren.add(c));
            } else if (this.isFilter(subFilter)) {
                const newColumns = this.findColumnsInFilter(
                    {
                        parentKey: newParentKey,
                        filter: subFilter
                    }
                );
                newColumns.forEach(c => columnsForChildren.add(c));
            }
        }
        if (columnsForChildren.size > 0) {
            columnsForChildren.forEach(c => columns.add(c));
        } else if (parentColumns.size > 0) {
            parentColumns.forEach(c => columns.add(c));
        }
        return columns;
    }
}

module.exports = {
    MongoQuerySimplifier
};
