"use strict";

require('dotenv').config();
const file_listener = require("./file_listener.js")
const servers = JSON.parse((process.env.Servers));

const file_events = file_listener.watch_files(servers);

const Rcon = require("rcon-client").Rcon
async function connect_rcon(port, pw) {
    const rcon = new Rcon({ host: "localhost", port: port, password: pw })
    await rcon.connect()
    return rcon
}

async function start() {
    const locals_rcons = {}
    for (let variable in servers["local_servers"]) {
        let object = servers["local_servers"][variable]
        locals_rcons[variable] = await connect_rcon(object.Rcon_port, object.Rcon_pass)
    }
    if (process.env.Is_lobby === 'true') {
        const { init } = require('./sever.js')
        const lobby = servers["lobby"]
        const lobby_rcon = connect_rcon(lobby.Rcon_port, lobby.Rcon_pass)
        init(lobby_rcon, locals_rcons, file_events)
    } else {
        const { init } = require('./client.js')
        init(locals_rcons, file_events)
    }

}
start()