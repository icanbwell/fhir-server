/**
 * from: https://www.mongodb.com/docs/manual/reference/explain-results/
 * @type {{FETCH: string, GROUP: string, SHARD_MERGE: string, COLLSCAN: string, SHARDING_FILTER: string, IXSCAN: string}}
 */
const friendlyDescriptionOfStages = {
    'COLLSCAN': 'for a collection scan',
    'IXSCAN': 'scanning index keys',
    'FETCH': 'retrieving documents',
    'GROUP': 'for grouping documents',
    'SHARD_MERGE': 'for merging results from shards',
    'SHARDING_FILTER': 'for filtering out orphan documents from shards'
};


/**
 * @typedef Step
 * @property {number} stepNo
 * @property {string} stage
 * @property {Object} [filter]
 * @property {string} [indexName]
 * @property {Step[]} [children]
 */

/**
 * @typedef ExplainExecutionStats
 * @property {number} nReturned
 * @property {number} executionTimeMillis
 * @property {number} totalKeysExamined
 * @property {number} totalDocsExamined
 */

/**
 * @typedef ExplainResult
 * @property {ExplainExecutionStats} [executionStats]
 * @property {Step} step
 * @property {import('mongodb').Document} query
 */

/**
 * explains plans
 */
class MongoExplainPlanHelper {

    /**
     * explains
     * inspired by: https://medium.com/mongodb-performance-tuning/getting-started-with-mongodb-explain-8a3d0c6c7e68
     * @param {{queryPlanner: Object, executionStats: Object, serverInfo: Object}} explanation
     * @param {import('mongodb').Document} query
     * @return {ExplainResult}}
     */
    quick_explain({explanation, query }) {
        /**
         * @type {{stage: string, transformBy: Object, inputStage: Object}}
         */
        const winningPlan = explanation.queryPlanner.winningPlan;

        const executionStats = explanation.executionStats;
        /**
         * @type {ExplainExecutionStats}
         */
        const myExecutionStats = {
            nReturned: executionStats.nReturned,
            executionTimeMillis: executionStats.executionTimeMillis,
            totalKeysExamined: executionStats.totalKeysExamined,
            totalDocsExamined: executionStats.totalDocsExamined
        };

        var stepNo = 1;

        /**
         * @type {Step}
         */
        const step = this.parseInputStage({stepNo, step: winningPlan});
        return {step: step, executionStats: myExecutionStats, query: query};
    }

    /**
     * @param {number} stepNo
     * @param {Object} step
     * @return {Step}
     */
    parseInputStage({stepNo, step}) {
        /**
         * @type {Step}
         */
        const result = {};
        if ('inputStage' in step) {
            if (!result.children) {
                result.children = [];
            }
            result.children.push(this.parseInputStage({stepNo, step: step.inputStage}));
        }
        if ('inputStages' in step) {
            for (const inputStage of step.inputStages) {
                result.children.push(this.parseInputStage({stepNo, step: inputStage}));
            }
        }
        /**
         * @type {{step: number, stage: string, [filter]: Object, [indexName]: string}}
         */
        const simplePlanItem = {step: stepNo++, stage: step.stage};

        if (friendlyDescriptionOfStages[step.stage]) {
            simplePlanItem.friendlyStage = friendlyDescriptionOfStages[step.stage];
        }

        if ('indexName' in step) {
            simplePlanItem.indexName = step.indexName;
        }
        if ('filter' in step) {
            simplePlanItem.filter = step.filter;
        }
        if ('docsExamined' in step) {
            simplePlanItem.docsExamined = step.docsExamined;
        }
        if ('keysExamined' in step) {
            simplePlanItem.keysExamined = step.keysExamined;
        }
        if ('numReads' in step) {
            simplePlanItem.numReads = step.numReads;
        }
        result.step = simplePlanItem;

        return result;
    }

    // executionStats(execStats) {
    //     var stepNo = 1;
    //     print('\n');
    //     var printSpaces = function (n) {
    //         var s = '';
    //         for (var i = 1; i < n; i++) {
    //             s += ' ';
    //         }
    //         return s;
    //     };
    //     var printInputStage = function (step, depth) {
    //         if ('inputStage' in step) {
    //             printInputStage(step.inputStage, depth + 1);
    //         }
    //         if ('inputStages' in step) {
    //             step.inputStages.forEach(function (inputStage) {
    //                 printInputStage(inputStage, depth + 1);
    //             });
    //         }
    //         var extraData = '(';
    //         if ('indexName' in step) {
    //             extraData += ' ' + step.indexName;
    //         }
    //         if ('executionTimeMillisEstimate' in step) {
    //             extraData += ' ms:' + step.executionTimeMillisEstimate;
    //         }
    //         if ('keysExamined' in step) {
    //             extraData += ' keys:' + step.keysExamined;
    //         }
    //         if ('docsExamined' in step) {
    //             extraData += ' docs:' + step.docsExamined;
    //         }
    //         extraData += ')';
    //         print(stepNo++, printSpaces(depth), step.stage, extraData);
    //     };
    //     printInputStage(execStats.executionStages, 1);
    //     print(
    //         '\nTotals:  ms:',
    //         execStats.executionTimeMillis,
    //         ' keys:',
    //         execStats.totalKeysExamined,
    //         ' Docs:',
    //         execStats.totalDocsExamined
    //     );
    // }
}

module.exports = {
    MongoExplainPlanHelper
};
