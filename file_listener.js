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
        fs.watch(dir, (event, filename) => {
            if (timeout || event !== 'change' || !filename) {
                return;
            }

            timeout = true;
            setTimeout(() => {
                timeout = false;
                fs.promises.readFile(path.join(dir, filename)).then(content => {
                    let object = JSON.parse(content);
                    if (!file_events.emit(object.type, server, object)) {
                        console.log(`Warning: Unhandled file event ${object.type}`);
                        console.log(object);
                    }
                }).catch(err => {
                    console.error(`Error reading ${filename} for ${ip}:`, err);
                });
            }, 150);
        });
    }
    return file_events;
};