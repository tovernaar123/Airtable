"use strict";

const events = require('events');
const fs = require('fs');
const path = require('path');


function resolveToAbsolutePath(file_path) {
    return file_path.replace(/%([^%]+)%/g, function(_, key) {
        return process.env[key];
    });
}

exports.watch_files = function(servers) {
    const file_events = new events.EventEmitter();
    const directories = [];
    for (let ip of Object.keys(servers["local_servers"])) {
        const object = servers["local_servers"][ip];
        let dir = resolveToAbsolutePath(object.dir);
        console.log(`Watching for file changes on ${dir}`);
        directories.push(dir);
    }

    let fsWait = false;
    function watch_file(file_path) {
        fs.watch(file_path, (_event, filename) => {
            if (filename) {
                if (fsWait) { return; }
                fsWait = setTimeout(() => {
                    fsWait = false;
                }, 100);
                let data = readfile(filename, file_path);
                let object = JSON.parse(data);
                file_events.emit(object.type, object);
            }
        });
    }
    for (let file_path of directories) {
        watch_file(file_path);
    }

    return file_events;
};


function readfile(filename, dir) {
    try {
        //eslint-disable-next-line no-sync
        let data = fs.readFileSync(path.join(dir, filename), 'utf8');
        return data;
    } catch (e) {
        console.error("error when reading file ", e.stack);
        return `Error: ${e.stack}`;
    }

}