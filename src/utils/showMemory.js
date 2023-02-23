const v8 = require('node:v8');
// Calling v8.getHeapStatistics()
console.log(v8.getHeapStatistics());
const memInGB = (v8.getHeapStatistics().total_available_size / 1024 / 1024 / 1024).toFixed(2);
console.log(`memInGB:${memInGB}`);
