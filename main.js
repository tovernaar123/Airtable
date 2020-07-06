"use strict";
require('dotenv').config();
var servers = JSON.parse((process.env.Servers));
global.servers = servers;
require("./file_listener.js")

const Rcon = require("rcon-client").Rcon
async function connect_rcon(port, pw) {
    const rcon = new Rcon({ host: "localhost", port: port, password: pw })
    await rcon.connect()
    return rcon
}
const lobby = servers["lobby"]
const lobby_rcon = connect_rcon(lobby.Rcon_port, lobby.Rcon_pass)
const { sockets, init } = require('./sever.js')
const locals_rcons = {}
for (let variable in servers["local_servers"]) {
    let object = servers["local_servers"][variable]
    locals_rcons[variable] = connect_rcon(object.Rcon_port, object.Rcon_pass)
}


init(lobby_rcon, locals_rcons)





async function ondata(msg) {
    let data = JSON.parse(msg);
    console.log(data)
    switch (data.type) {
        case "start":
            var args = data.args
            args = args.join(' ')
            var server_object = servers.local_servers[data.sever]
            var rcon2 = await connect_rcon(server_object.Rcon_port, server_object.Rcon_pass)
            setTimeout(async function() {
                await rcon2.send("/start " + args)
                rcon2.end()
            }, 10000)
            global.airtable_id = data.id
            break;
        case 'lobby_set':
            var lobby = data.data
            for (let name in servers.local_servers) {
                var server_object = servers.local_servers[name]
                const rcon = await connect_rcon(server_object.Rcon_port, server_object.Rcon_pass)
                await rcon.send(`/interface global.servers = {lobby = '${lobby}'}`)
                console.log(`/interface global.servers = {lobby = '${lobby}'}`)
                await rcon.end()
            }
            break;
        default:
            if (data.type === "connected") { console.log("Connected to server."); return }
            console.log("Unkown type " + data.type)
            break
    }
}

global.tell_server = async function(args, server, id) {
    if (servers["local_servers"][server] != undefined) {
        args = args.join(' ')
        const server_object = servers.local_servers[server]
        var rcon2 = await connect_rcon(server_object.Rcon_port, server_object.Rcon_pass)
        setTimeout(async function() {
            await rcon2.send("/start " + args)
            rcon2.end()
        }, 30000)
    } else {
        if (!variables.Is_lobby) { console.error("Server start must be on lobby"); return }
        const str_key = servers["remote_servers"][server]
        if (sockets[str_key] === undefined) { console.error("cant find server"); return }
        sockets[str_key].send(JSON.stringify({ "type": "start", "args": args, "sever": server, "id": id }));
    }

}
async function print_who_won(object) {
    setTimeout(async function() {
        const server_object2 = servers.lobby
        var rcon2 = await connect_rcon(server_object2.Rcon_port, server_object2.Rcon_pass)
        var rcon2 = await connect_rcon(server_object2.Rcon_port, server_object2.Rcon_pass)
        await rcon2.send("/sc game.print( \"[color=#FFD700]1st: " + object.Gold + " with a score of " + object.Gold_data + ".[/color]\")")
        if (object.Silver != undefined) {
            await rcon2.send("/sc game.print( \"[color=#C0C0C0]2nd: " + object.Silver + " with a score of " + object.Silver_data + ".[/color]\")")
            if (object.Bronze != undefined) {
                await rcon2.send("/c game.print(\"[color=#cd7f32]3rd:" + object.Bronze + " with a score of" + object.Bronze_data + ".[/color]\")")
            }
        }
        rcon2.end()
    }, 1000)
}

global.send_players = async function(server, object) {
    const server_object = servers.local_servers[server]
    var rcon = await connect_rcon(server_object.Rcon_port, server_object.Rcon_pass)
    await rcon.send("/stop_games")
    setTimeout(async function() {
        await rcon.send("/kill_all")
        await rcon.end()
    }, 5000)
    if (variables.Is_lobby) {
        print_who_won(object)
    } else {
        server.send(JSON.stringify({ "type": "end_game", "data": object }));
    }
}