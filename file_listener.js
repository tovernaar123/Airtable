"use strict";

const events = require('events');
const fs = require('fs');
const path = require('path');
let file_events;

function resolveToAbsolutePath(file_path) {
    return file_path.replace(/%([^%]+)%/g, function(_, key) {
        return process.env[key];
    });
}

exports.watch_files = function(servers) {
    file_events = new events.EventEmitter();
    const directories = [];
    for (let ip of Object.keys(servers["local_servers"])) {
        const object = servers["local_servers"][ip];
        let dir = resolveToAbsolutePath(object.dir);
        console.log(`Watching for file changes on ${dir}`);
        directories.push(dir);
    }

    function watch_file(file_path) {
        fs.watch(file_path, (event, filename) => {
            if (filename) {
                readfile(filename, file_path);
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
        fs.readFile(path.join(dir, filename), 'utf8', (err, data) => {
            if (err) { throw err; };
            let object = JSON.parse(data);
            file_events.emit(object.type, object);
        });
        return data;
    } catch (e) {
        console.error("error when reading file ", e.stack);
        return `Error: ${e.stack}`;
    }

}