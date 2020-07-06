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


const servers = JSON.parse((process.env.Servers));

const base = new Airtable({ apiKey: process.env.Api_key }).base(process.env.Base_key);
const file_events = file_listener.watch_files(servers);


async function connect_rcon(port, pw) {
    const rcon = new Rcon({ host: "localhost", port: port, password: pw })
    await rcon.connect()
    return rcon
}

var sockets = {}
var server;
if (process.env.Is_lobby === "true") {
    console.log("running as server")
    var config;
    var secret;
    const wss = new WebSocket.Server({ noServer: true });
    wss.on("connection", function(ws, request) {
        console.log(`Received connection from ${request.socket.remoteAddress}`);
        ws.send(JSON.stringify({ "type": "connected" }));
        ws.on("message", async function(msg) {
            console.log(msg)
            let data = JSON.parse(msg);
            if (data.type === "server_object") {
                console.log(data.data)
                var object_for_lua = data.data
                var object = servers["lobby"]
                const rcon = await connect_rcon(object.Rcon_port, object.Rcon_pass)
                var result = await rcon.send(`/interface return game.table_to_json(global.servers)`)
                result = JSON.parse(result.split('\n')[0])
                console.log(result)
                console.log(object_for_lua)
                for (let [key, value] of Object.entries(result)) {
                    if (object_for_lua[key]) {
                        object_for_lua[key].push(...value);
                    } else {
                        object_for_lua[key] = value;
                    }
                }
                console.log(object_for_lua)
                var json = JSON.stringify(object_for_lua)
                var json2 = {}
                json2.type = 'lobby_set'
                json2.data = object_for_lua.lobby
                ws.send(JSON.stringify(json2))
                rcon.send(`/interface global.servers= game.json_to_table('${json}')`)
                return
            }
            if (data.id != undefined) {
                sockets[data.id] = ws
            } else {
                if (data.type === "end_game") {
                    print_who_won(data["data"].object)
                }
            }
            console.log("got data")
            console.log(data);
        });

        ws.on("close", function(code, reason) {
            console.log(`Connection from ${request.socket.remoteAddress} closed`);
        });
    });

    function authenticate(request) {
        let token = request.headers["authorization"];
        if (!token) {
            return false;
        }

        try {
            jwt.verify(token, secret);

        } catch (err) {
            return false;
        }

        return true;
    }


    async function start() {
        //let bytes = await util.promisify(crypto.randomBytes)(256);
        //bytes.toString("base64")
        //token: jwt.sign({}, bytes)
        secret = Buffer.from(process.env.secret, "base64");
        let server = https.createServer({
            key: await fs.readFile(process.env.key),
            cert: await fs.readFile(process.env.cert),
        });

        server.on("upgrade", function(request, socket, head) {
            if (!authenticate(request)) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, function done(ws) {
                wss.emit("connection", ws, request);
            });
        });

        await new Promise((resolve, reject) => {
            server.on("error", reject);
            server.listen(process.env.port, "0.0.0.0", () => {
                server.off("error", reject);
                console.log(`listening on ${process.env.port}`);
                resolve();
            });
        });
    }

    if (require.main === module) {
        start().catch(err => {
            console.error(err);
            process.exitCode = 1;
        });
    }
} else {
    var reconnecting = false
    var interval_token
    async function client() {
        let cert = await fs.readFile(process.env.cert);

        let options = {
            headers: { "Authorization": process.env.token },
            port: 1
        }
        if (cert) {
            options.ca = cert;
        }
        if (/(\d+\.){3}\d+/.test(new URL(process.env.url).hostname)) {
            // Overzealous ws lib adds SNI for IP hosts.
            options.servername = "";
        }
        let ws = new WebSocket(process.env.url, options);
        ws.on("open", function() {
            ws.send(JSON.stringify({ "id": "expgaming" }));
            if (reconnecting) {
                clearInterval(interval_token)
            }
        });
        ws.on("message", function(msg) {
            ondata(msg)
        });
        ws.on("error", function(error) {
            if (reconnecting) {
                console.log("cant reconnect try again in 10 sec")
            } else {
                console.error(error)
            }
        })
        ws.on("close", function() {
            console.log("Connection lost");
            if (!reconnecting) {
                interval_token = setInterval(function() {
                    client()
                }, 10000)
            }
            reconnecting = true
        });
        server = ws
    }

    if (require.main === module) {
        client().catch(err => {
            console.error(err);
            process.exitCode = 1;
        });
    }
}
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

async function do_init() {
    var object_for_lua = {}
    for (let variable in servers["local_servers"]) {
        const object = servers["local_servers"][variable]
        const rcon = await connect_rcon(object.Rcon_port, object.Rcon_pass)

        const is_lobby = object.is_lobby
        const ip = variable
        await rcon.send(`/set_lobby ${is_lobby}`)
        await rcon.send(`/set_server_address ${ip}`)
        if (is_lobby) {
            console.log(`${variable} is the lobby. `)
            object_for_lua['lobby'] = variable
            await rcon.end()
            continue
        }
        var result = await rcon.send('/interface local result = {} for i , surface in pairs(game.surfaces) do result[surface.name] = true end return game.table_to_json(result)')
        var result2 = await rcon.send('/interface local result = {} for name,mini_game in pairs(mini_games.mini_games)do result[mini_game.map] = name end return game.table_to_json(result)')
        await rcon.end()
        var result = result.split('\n')[0]
        const json1 = JSON.parse(result)
        var result = result2.split('\n')[0]
        const json2 = JSON.parse(result)
        var games = []
        for (let name in json2) {
            if (json1[name] != undefined) {
                var internal_name = json2[name]
                if (object_for_lua[internal_name] == undefined) { object_for_lua[internal_name] = [] }
                object_for_lua[internal_name].push(variable)
                games.push(internal_name)
            }
        }
        games = games.join(' and ')
        console.log(`${variable} is running ${games}. `)
    }
    if (process.env.Is_lobby == 'true') {

        var object = servers["lobby"]
        const rcon = await connect_rcon(object.Rcon_port, object.Rcon_pass)
        const result = await rcon.send(`/interface return game.table_to_json(global.servers)`)
        for (let variable in object_for_lua) {
            if (variable === 'lobby') {} else {
                if (result[variable] != undefined) {
                    var object = object_for_lua[variable]
                    object_for_lua[variable] = object.Concat(result[variable])
                }
            }
        }
        var json = JSON.stringify(object_for_lua)
        console.log(result)

        await rcon.send(`/interface global.servers= game.json_to_table('${json}')`)
        console.log(object_for_lua)
    } else {
        server.send(JSON.stringify({ "type": 'server_object', "id": "expgaming", "data": object_for_lua }))
    }
}
do_init()

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
    tell_server(object.arguments, object.server, airtable_id)
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
    send_players(object.server, object)
    console.log(base('Scoring Data').update(json))
});