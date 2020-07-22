"use strict";
require('dotenv').config();
const Rcon = require("rcon-client").Rcon;

const file_listener = require("./file_listener.js");
const init = require(process.env.Is_lobby === 'true' ? "./server.js" : "./client.js");


async function connect_rcon(port, pw) {
    const rcon = new Rcon({ host: "localhost", port: port, password: pw });
    await rcon.connect();
    return rcon;
}

async function start() {
    const servers = JSON.parse((process.env.Servers));
    const file_events = file_listener.watch_files(servers);

    const locals_rcons = {};
    for (let [ip, server] of Object.entries(servers["local_servers"])) {
        locals_rcons[ip] = await connect_rcon(server.Rcon_port, server.Rcon_pass);
    }

    if (process.env.Is_lobby === 'true') {
        const lobby = servers["lobby"];
        const lobby_rcon = await connect_rcon(lobby.Rcon_port, lobby.Rcon_pass);
        await init(lobby_rcon, locals_rcons, file_events);

    } else {
        await init(locals_rcons, file_events);
    }
}

if (require.main === module) {
    start().catch(err => {
        console.error(err);
        //eslint-disable-next-line no-process-exit
        process.exit(1);
    });
}