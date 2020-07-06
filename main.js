"use strict";
require('dotenv').config();

const Airtable = require('airtable');
const clone = require('rfdc')()
const crypto = require("crypto");
const fs = require("fs").promises;
const jwt = require("jsonwebtoken");
const https = require("https");
const Rcon = require("rcon-client").Rcon
const util = require("util");
const WebSocket = require("ws");

const file_listener = require("./file_listener.js")
const airtable = require("./airtable_object.js")
const { sockets, init } = require('./sever.js')
const { airtable_init } = require('./airtable.js')
const servers = JSON.parse((process.env.Servers));

const base = new Airtable({ apiKey: process.env.Api_key }).base(process.env.Base_key);
const file_events = file_listener.watch_files(servers);
async function connect_rcon(port, pw) {
    const rcon = new Rcon({ host: "localhost", port: port, password: pw })
    await rcon.connect()
    return rcon
}

async function start() {
    const lobby = servers["lobby"]
    const lobby_rcon = connect_rcon(lobby.Rcon_port, lobby.Rcon_pass)
    const locals_rcons = {}
    for (let variable in servers["local_servers"]) {
        let object = servers["local_servers"][variable]
        locals_rcons[variable] = await connect_rcon(object.Rcon_port, object.Rcon_pass)
    }

    airtable_init(file_events)
    init(lobby_rcon, locals_rcons, file_events)


}
start()





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



async function tell_server(args, server, id) {
    if (servers["local_servers"][server] != undefined) {
        args = args.join(' ')
        const server_object = servers.local_servers[server]
        var rcon2 = await connect_rcon(server_object.Rcon_port, server_object.Rcon_pass)
        setTimeout(async function() {
            await rcon2.send("/start " + args)
            rcon2.end()
        }, 30000)
    } else {
        if (process.env.Is_lobby != 'true') {
            console.error("Server start must be on lobby");
            return;
        }
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

async function send_players(server, object) {
    const server_object = servers.local_servers[server]
    var rcon = await connect_rcon(server_object.Rcon_port, server_object.Rcon_pass)
    await rcon.send("/stop_games")
    setTimeout(async function() {
        await rcon.send("/kill_all")
        await rcon.end()
    }, 5000)
    if (process.env.Is_lobby == 'true') {
        print_who_won(object)
    } else {
        server.send(JSON.stringify({ "type": "end_game", "data": object }));
    }
}


file_events.on("Started_game", async function(object) {
    var json = clone(require("./score_template.json"));
    var player_ids = []
    for (let player of object.players) {
        player_ids.push(await airtable.get_player_id(base, player))
    }
    json[0].fields["Players Present"] = player_ids
    json[0].fields["Time Started"] = new Date().toISOString();
    json[0].fields["Game"][0] = await airtable.get_game_id(base, object.name)
    console.log("game starting with ")
    console.log(json)
    const created = await base('Scoring Data').create(json)
    console.log(created)
    global.airtable_id = created[0].id


    object.arguments.unshift(object.name)
    console.log(object.arguments)
});

file_events.on("end_game", async function(object) {
    var current_timeDate = new Date()
    var json = clone(require("./score_update_template.json"));
    var players
    json[0].id = airtable_id
    await Promise.all([
        airtable.get_player_id(base, object.Gold),
        airtable.get_player_id(base, object.Silver),
        airtable.get_player_id(base, object.Bronze),
    ]).then((values) => {
        players = values
    });
    players = players.filter(function(el) {
        return el != undefined;
    });
    json[0].fields["Gold Player"][0] = players[0]
    json[0].fields["Gold Data"] = object["Gold_data"]
    if (players[2] != undefined) {
        json[0].fields["Silver Player"][0] = players[1]
        json[0].fields["Silver Data"] = object["Silver_data"]
        if (players[3] != undefined) {
            json[0].fields["Bronze Player"][0] = players[2]
            json[0].fields["Bronze Data"] = object["Bronze_data"]
        } else {
            delete json[0].fields["Bronze Player"]
            delete json[0].fields["Bronze Data"]
        }
    } else {
        delete json[0].fields["Silver Player"]
        delete json[0].fields["Silver Data"]
        delete json[0].fields["Bronze Player"]
        delete json[0].fields["Bronze Data"]
    }
    var begin_time = await airtable.general_lookup(base, "Scoring Data", "Match ID", airtable_id, "Time Started")
    begin_time = new Date(begin_time)
    var difernce = (current_timeDate - begin_time) / 1000 * 60
    json[0].fields["Duration"] = difernce
    console.log("game ending with ")
    console.log(json)
    console.log(base('Scoring Data').update(json))
});