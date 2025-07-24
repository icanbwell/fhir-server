const { CronTasksProcessor } = require('../../utils/cronTasksProcessor');

class MockCronTasksProcessor extends CronTasksProcessor {
    async initiateTasks() {
        // do nothing
    }
}

module.exports = {
    MockCronTasksProcessor
};
