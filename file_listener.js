"use strict";

const fs = require('fs');
const path = require('path');
const { print_error } = require('./helpers.js');


function resolveToAbsolutePath(file_path) {
    return file_path.replace(/%([^%]+)%/g, function(_, key) {
        //eslint-disable-next-line no-process-env
        return process.env[key];
    });
}

exports.watch_files = function(server) {
    const directories = [];

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
                //Remove the file in the background, the 3Ra web panel causes them to keep triggering
                fs.promises.unlink(path_to_file).catch(print_error("removing file from file_event"));

                let event = JSON.parse(content);
                return server.file_event(event).catch(
                    print_error(`during file event ${event.type}`)
                );
            }).catch(print_error(`reading ${filename} for ${server.ip}:`));
        }, 150);
    });
};