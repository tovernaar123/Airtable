"use strict";
const WebSocket = require("ws");
const fs = require("fs").promises;
const { started_game, stopped_game } = require('./airtable.js');
const { lua_array, print_error } = require('./helpers.js');


let player_roles = {};

let servers;
let websocket;
let lobby_ip;


exports.init = async function(config, init_servers, server) {
    servers = init_servers;

    if (!config.is_server) {
        //Load tls certificate for websocket connection if it is configured
        let cert = config.tls_cert_file ? await fs.readFile(config.tls_cert_file) : null;
        connect_websocket(config.ws_url, config.ws_token, cert);
    }
};

exports.connect_local_server = function connect_local_server(server_ws) {
    websocket = server_ws;
};

//Handle rcon connection established with a Factorio server
exports.server_connected = async function server_connected(server) {
    //telling the server if this the lobby
    await server.rcon.send(`/set_lobby ${server.is_lobby}`);

    //if the server is the lobby log it and continue as the lobby cant have games
    if (server.is_lobby) {
        console.log(`${server.ip} is the lobby. `);

    } else {
        //Set the ip of the lobby if available
        if (lobby_ip !== undefined) {
            await server.rcon.send(`/interface global.servers = {lobby = '${lobby_ip}'}`);
        }

        //Get all mini games the server can run
        let result = await server.rcon.send(`/interface return game.table_to_json(mini_games.available)`);

        //Remove the command complete line
        result = result.split('\n')[0];
        server.games = lua_array(JSON.parse(result));
    }

    if (Object.keys(player_roles).length !== 0) {
        await server.rcon.send(`/interface 
            Roles.override_player_roles(
                game.json_to_table('${JSON.stringify(player_roles)}')
            )`.replace(/\r?\n +/g, ' ')
        );
    }

    server.online = true;
    send_server_list();
};

exports.server_disconnected = function server_disconnected(server) {
    server.online = false;
    server.game_running = null;
    send_server_list();
};

function send(text) {
    //Check if connected either to local or remote server
    if (websocket && (!(websocket instanceof WebSocket) || websocket.readyState === WebSocket.OPEN)) {
        websocket.send(text);
    }
}
exports.send = send;

function send_server_list() {
    let server_list = {};
    for (let [ip, server] of servers) {
        if (server.online) {
            server_list[ip] = {
                "games": server.games,
                "game_running": server.game_running,
            };
        }
    }

    send(JSON.stringify({ "type": 'server_list', "servers": server_list }));
}
exports.send_server_list = send_server_list;


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
    let ping_interval;
    ws.on("open", function() {
        console.log("WebSocket connection open");
        ping_interval = setInterval(() => {
            ws.ping();
        }, 5000);
    });
    ws.on("message", function(message) {
        on_message(JSON.parse(message)).catch(print_error(`on_message(${message}) failed`));
    });
    ws.on("error", function(error) {
        console.error("WebSocket connection error:", error.message);
    });
    ws.on("close", function() {
        console.log("WebSocket connection lost, reconnecting in 10 seconds");
        clearInterval(ping_interval);
        setTimeout(function() {
            connect_websocket(url, token, cert);
        }, 10000);
    });
    websocket = ws;
}

//Invoked when a message is received from the WebSocket server.
async function on_message(message) {
    console.log(`data recieved: ${JSON.stringify(message, null, 4)}`);
    if (message.type === 'start_game') {
        let server = servers.get(message.server);
        if (server && server.rcon.authenticated) {
            let args = "";
            for (let arg of message.args) {
                if (/ /.test(arg)) {
                    args += ` "${arg}"`;
                } else {
                    args += ` ${arg}`
                }
            }
            await server.rcon.send(`/start "${message.name}" ${message.player_count}${args}`);
            server.game_running = message.name;
            send_server_list();
        } else {
            console.log(`Received start for unavailable server ${message.server}`);
        }
    } else if (message.type === 'connected') {
        //Update main server's list of server
        send_server_list();

        //Update stored lobby ip
        lobby_ip = message.lobby_ip;

        //loop over all the local server and set the lobby
        for (let connected_server of servers.values()) {
            if (!connected_server.is_lobby && connected_server.rcon.authenticated) {
                await connected_server.rcon.send(`/interface global.servers = {lobby = '${lobby_ip}'}`);
            }
        }
    } else if (message.type === 'init_roles') {
        for (let [key, server] of servers) {
            if (server.online) {
                await server.rcon.send(`/interface 
                    Roles.override_player_roles(
                        game.json_to_table('${JSON.stringify(message.roles)}')
                    )`.replace(/\r?\n +/g, ' ')
                );
            }
        }
        player_roles = message.roles;
    } else if (message.type === 'added_roles') {
        for (let [key, server] of servers) {
            if (server.online) {
                await server.rcon.send(`/interface
                    Roles.assign_player(
                        '${message.name}',
                        game.json_to_table('${JSON.stringify(message.roles)}'), 
                        nil, 
                        true, 
                        true
                    )`.replace(/\r?\n +/g, ' '));
            }
        }
        player_roles = message.new_roles;
    } else if (message.type === 'removed_roles') {
        for (let [key, server] of servers) {
            if (server.online) {
                await server.rcon.send(`/interface
                    Roles.unassign_player(
                        '${message.name}',
                        game.json_to_table('${JSON.stringify(message.roles)}'), 
                        nil, 
                        true, 
                        true
                    )`.replace(/\r?\n +/g, ' '));
            }
        }
        player_roles = message.new_roles;
    } else {
        console.log(`Unkown type ${data.type}`);
    }
}
exports.on_message = on_message;