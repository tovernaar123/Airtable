"use strict";

const events = require('events');
const fs = require('fs');
const path = require('path');


function resolveToAbsolutePath(file_path) {
    return file_path.replace(/%([^%]+)%/g, function(_, key) {
        //eslint-disable-next-line no-process-env
        return process.env[key];
    });
}

exports.watch_files = function(servers) {
    const file_events = new events.EventEmitter();
    const directories = [];
    for (let [ip, server] of servers) {
        let dir = resolveToAbsolutePath(server.dir);
        console.log(`Watching for file changes on ${dir}`);

        let timeout = false;
        //Eslint doesn't seem to understand variable scoping :/
        //eslint-disable-next-line no-loop-func
        fs.watch(dir, (file_event, filename) => {
            if (timeout || file_event !== 'change' || !filename) {
                return;
            }

            timeout = true;
            setTimeout(() => {
                timeout = false;
                let path_to_file = path.join(dir, filename);
                fs.promises.readFile(path_to_file).then(content => {
                    let event = JSON.parse(content);
                    event.path_to_file = path_to_file;
                    if (!file_events.emit(event.type, server, event)) {
                        console.log(`Warning: Unhandled file event ${event.type}`);
                        console.log(event);
                    }
                }).catch(err => {
                    console.error(`Error reading ${filename} for ${ip}:`, err);
                });
            }, 150);
        });
    }
    return file_events;
};