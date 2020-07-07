"use strict";

const events = require('events');
const fs = require('fs');
const path = require('path');


function resolveToAbsolutePath(path) {
    return path.replace(/%([^%]+)%/g, function(_, key) {
        return process.env[key];
    });
}

exports.watch_files = function(servers) {
    const file_events = new events.EventEmitter();
    const directories = [];
    for (let variable in servers["local_servers"]) {
        const object = servers["local_servers"][variable];
        let dir = resolveToAbsolutePath(object.dir);
        console.log(`Watching for file changes on ${dir}`);
        directories.push(dir);
    }

    let fsWait = false;
    for (let path of directories) {
        fs.watch(path, (event, filename) => {
            if (filename) {
                if (fsWait) return;
                fsWait = setTimeout(() => {
                    fsWait = false;
                }, 100);
                let data = readfile(filename, path);
                console.log(data);
                let object = JSON.parse(data);
                file_events.emit(object.type, object);
            }
        });;
    }

    return file_events;
};


function readfile(filename, dir) {
    try {
        let data = fs.readFileSync(path.join(dir, filename), 'utf8');
        return data;
    } catch (e) {
        console.error("error when reading file ", e.stack);
        return `Error: ${e.stack}`;
    }

}