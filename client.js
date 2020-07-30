"use strict";
const WebSocket = require("ws");
const fs = require("fs").promises;
const events = require('events');

let player_roles = {};
const role_events = new events.EventEmitter();
role_events.on("newListener", (event, listener) => {
    if (event === "init") {
        if (Object.keys(player_roles).length !== 0) {
            listener(player_roles);
        }
    }
});
const { started_game, stopped_game } = require('./airtable.js');
const { lua_array, print_error } = require('./helpers.js');


let servers;
let websocket;
let lobby_ip;


exports.init = async function(config, init_servers, base, file_events, rcon_events) {
    servers = init_servers;

    for (let server of servers.values()) {
        if (server.is_lobby === true) {
            throw new Error('Client cannot have the lobby server');
        }
    }

    rcon_events.on("connect", function(ip, server) {
        server_connected(ip, server).catch(print_error(`setting up rcon connection to ${ip}:`));
    });

    rcon_events.on("close", function(ip, server) {
        server_disconnected(ip, server);
        console.log(`lost rcon connection with ${ip}`);
    });

    file_events.on("started_game", function(server, event) {
        console.log(event);
        started_game(base, event.name, lua_array(event.players)).then(record_id => {
            server.record_id = record_id;
        }).catch(print_err("calling started_game"));
    });

    file_events.on("stopped_game", async function(server, event) {
        if (server.record_id) {
            let record_id = server.record_id;
            server.record_id = null;
            await stopped_game(base, lua_array(event.results), record_id);

        } else {
            console.log(`Received stopped_game, but missing airtable record_id`);
            console.log(JSON.stringify(event));
        }
        setTimeout(async function() {
            await server.rcon.send("/lobby_all");
        }, 10000);

        //In 20 sec kick all players
        setTimeout(async function() {
            await server.rcon.send("/kick_all");
        }, 20000);

        websocket.send(JSON.stringify(event));
    });

    //Load tls certificate for websocket connection if it is configured
    let cert = config.tls_cert_file ? await fs.readFile(config.tls_cert_file) : null;
    connect_websocket(config.ws_url, config.ws_token, cert);
};

//Handle rcon connection established with a Factorio server
async function server_connected(ip, server) {
    if (server.is_lobby) {
        throw new Error("Client cannot have the lobby server");
    }

    //Ensure the server knows it is not the lobby.
    await server.rcon.send(`/set_lobby false`);

    //Set the ip of the lobby if available
    if (lobby_ip !== undefined) {
        await server.rcon.send(`/interface global.servers = {lobby = '${lobby_ip}'}`);
    }

    //Get all mini games the server can run
    let result = await server.rcon.send(`/interface return game.table_to_json(mini_games.available)`);

    server.player_roles_init = async function(players_roles) {
        await server.rcon.send(`/interface 
        Roles.override_player_roles(
            game.json_to_table('${JSON.stringify(players_roles)}')
        )`.replace(/\r?\n +/g, ' ')
        );
    };

    server.added_roles = async function (roles, name) {
        await server.rcon.send(`/interface
        Roles.assign_player(
            '${name}',
            game.json_to_table('${JSON.stringify(roles)}'), 
            nil, 
            true, 
            true
        )`.replace(/\r?\n +/g, ' '));
    };

    server.removed_roles = async function (roles, name) {
        await server.rcon.send(`/interface
        Roles.unassign_player(
            '${name}',
            game.json_to_table('${JSON.stringify(roles)}'), 
            nil, 
            true, 
            true
        )`.replace(/\r?\n +/g, ' '));
    };

    role_events.on('init', server.player_roles_init);
    role_events.on('added_roles', server.added_roles);
    role_events.on('removed_roles', server.removed_roles);
    //Remove the command complete line
    result = result.split('\n')[0];
    server.games = lua_array(JSON.parse(result));
    server.online = true;
    send_server_list();
}

function server_disconnected(ip, server) {
    server.online = false;
    role_events.removeListener('removed_roles', server.removed_roles);
    role_events.removeListener('init', server.player_roles_init);
    role_events.removeListener('added_roles', server.added_roles);
    send_server_list();
}

function send_server_list() {
    if (websocket.readyState !== WebSocket.OPEN) {
        //Not connected to the server yet
        return;
    }

    let server_list = {};
    for (let [ip, server] of servers) {
        if (server.online) {
            server_list[ip] = {
                "games": server.games || [],
            };
        }
    }

    websocket.send(JSON.stringify({ "type": 'server_list', "servers": server_list }));
}


//setup connection to the websocket interface of the server
function connect_websocket(url, token, cert) {
    let options = {
        headers: { "Authorization": token },
    };
    if (cert) {
        options.ca = cert;
    }
    if (/(\d+\.){3}\d+/.test(new URL(url).hostname)) {
        //Overzealous ws lib adds SNI for IP hosts.
        options.servername = "";
    }
    let ws = new WebSocket(url, options);
    ws.on("open", function() {
        //empty
    });
    ws.on("message", function(message) {
        on_message(JSON.parse(message)).catch(print_error(`on_message(${message.type}) failed`));
    });
    ws.on("error", function(error) {
        console.error("WebSocket connection error:", error.message);
    });
    ws.on("close", function() {
        console.log("WebSocket connection lost, reconnecting in 10 seconds");
        setTimeout(function() {
            connect_websocket(url, token, cert);
        }, 10000);
    });
    websocket = ws;
}

//Invoked when a message is received from the WebSocket server.
async function on_message(message) {
    console.log(`data recieved: ${JSON.stringify(message, null, 4)}`);
    switch (message.type) {
        case 'start_game':
            let server = servers.get(message.server);
            if (server && server.rcon.authenticated) {
                await server.rcon.send(`/start ${message.name} ${message.player_count} ${message.args}`);
            } else {
                console.log(`Received start for unavailable server ${message.server}`);
            }
            break;
        case 'connected':
            //Update main server's list of server
            send_server_list();

            //Update stored lobby ip
            lobby_ip = message.lobby_ip;

            //loop over all the local server and set the lobby
            for (let connected_server of servers.values()) {
                if (connected_server.rcon.authenticated) {
                    await connected_server.rcon.send(`/interface global.servers = {lobby = '${lobby_ip}'}`);
                }
            }
            break;
        case 'init_roles':
            role_events.emit('init', message.roles);
            player_roles = message.roles;
            break;
        case 'added_roles':
            role_events.emit('added_roles', message.roles, message.name);
            player_roles = message.new_roles;
            break;
        case 'removed_roles':
            role_events.emit('removed_roles', message.roles, message.name);
            player_roles = message.new_roles;
            break;
        default:
            console.log(`Unkown type ${data.type}`);
            break;
    }
}