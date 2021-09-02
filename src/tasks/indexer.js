// from https://riptutorial.com/node-js/example/21833/processing-long-running-queries-with-node
process.on('message', function (message) {
    console.log('message', message);
    //send status update to the main app
    process.send({status: 'We have started processing your data.'});

    //long calculations ..
    setTimeout(function () {
        process.send({status: 'Done!'});
        console.log({status: 'Done!'});

        //notify node, that we are done with this task
        process.disconnect();
    }, 5000);
});

process.on('uncaughtException', function (err) {
    console.log('Error happened: ' + err.message + '\n' + err.stack + '.\n');
    console.log('Gracefully finish the routine.');
});
