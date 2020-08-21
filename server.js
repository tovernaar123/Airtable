"use strict";
const fs = require("fs").promises;
const https = require("https");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");

const { stopped_game, started_game, init: airtable_init, airtable_events, player_roles} = require('./airtable.js');
const { lua_array, print_error } = require('./helpers.js');


let socket_to_client_data = new Map();
let lobby_server;
let lobby_ip;
let servers;
let airtable_init_done = false;
airtable_events.on('init', (roles) => {
    for (let [ws, value] of socket_to_client_data.entries()) {
        ws.send(JSON.stringify({
            "type": 'init_roles',
            "roles": roles,
        }));
    }
    airtable_init_done = true;
});
airtable_events.on('added_roles', (roles, name) => {
    for (let [ws, value] of socket_to_client_data.entries()) {
        ws.send(JSON.stringify({
            "type": 'added_roles',
            "name": name,
            "roles": roles,
            'new_roles': player_roles,
        }));
    }
});
airtable_events.on('removed_roles', (roles, name) => {
    for (let [ws, value] of socket_to_client_data.entries()) {
        ws.send(JSON.stringify({
            "type": 'removed_roles',
            "name": name,
            "roles": roles,
            'new_roles': player_roles,
        }));
    }
});

exports.init = async function(config, init_servers, base, file_events, rcon_events) {
    console.log("running as server");
    servers = init_servers;

    //Find the lobby server among the local servers.
    let lobby_servers = [];
    for (let [ip, server] of servers) {
        if (server.is_lobby) {
            lobby_servers.push([ip, server]);
        }
    }
    if (lobby_servers.length !== 1) {
        throw new Error(`Excepted there to be exactly one lobby server but got ${lobby_servers.length}`);
    }
    [lobby_ip, lobby_server] = lobby_servers[0];

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
        }).catch(print_error("calling started_game"));
    });

    file_events.on("start_cancelled", function(server, event) {
        server.game_running = null;
        server.rcon.send('/sc game.print("Returning to lobby in 5 sec")').catch(console.error);
        setTimeout(async function() {
            await server.rcon.send("/lobby_all");
        }, 5000);

        //In 20 sec kick all players
        setTimeout(async function() {
            await server.rcon.send("/kick_all");
        }, 15000);
        update_lobby_server_list().catch(print_error("during start_cancelled"));
    });
    //when the start_game game event is run in file_listener this function will run
    file_events.on("start_game", function(server, event) {
        //log the argmunts
        console.log(`game arguments are ${JSON.stringify(event.args)}`);

        //Checking if the server is local
        if (servers.has(event.server)) {
            let target_server = servers.get(event.server);
            if (target_server.rcon.authenticated) {
                target_server.rcon.send(`/start "${event.name}" ${event.player_count} ${event.args.join(' ')}`).catch(
                    print_error("sending /start command to local server")
                );
                target_server.game_running = event.name;
                update_lobby_server_list().catch(print_error("updating lobby during start_game"));

            } else {
                console.log(`Received start for unavailable server ${event.server}`);
            }


        } else {
            //Get the socket of the server
            let ws;
            for (let [client_ws, client_data] of socket_to_client_data) {
                if (client_data.servers[event.server]) {
                    ws = client_ws;
                    break;
                }
            }

            //If the socket was found, send start game message to it
            if (ws) {
                ws.send(JSON.stringify(event));

            } else {
                console.log(`Received start for unavailable server ${event.server}`);
            }
        }
    });

    file_events.on("stopped_game", function(server, event) {
        server.game_running = null;
        update_lobby_server_list().catch(print_error("updating lobby server on stopped_game"));

        if (server.record_id) {
            let record_id = server.record_id;
            server.record_id = null;
            stopped_game(base, lua_array(event.results), record_id).catch(print_error("calling stopped_game"));

        } else {
            console.log(`Received stopped_game, but missing airtable record_id`);
            console.log(JSON.stringify(event));
        }

        //Send all players to do lobby
        setTimeout(function() {
            server.rcon.send("/lobby_all").catch(print_error("sending /lobby_all"));
        }, 10000);

        //In 20 sec kick all players
        setTimeout(function() {
            server.rcon.send("/kick_all").catch(print_error("sending /kick_all"));
        }, 20000);

        //In 20 sec also print all the scores
        setTimeout(function() {
            print_winners(lua_array(event.results)).catch(print_error("calling print_winners for local game"));
        }, 20000);
    });

    file_events.on("player_count_changed", function(server, event) {
        let ip;
        for (let [_ip, _server] of servers) {
            if (_server === server) {
                ip = _ip;
            }
        }
        lobby_server.rcon.send(`/interface mini_games.set_online_player_count(${event.amount}, "${ip}") `)
            .catch(print_error("during player_count_changed"));
    });
    await airtable_init(base);

    //start the HTTPS/WebSocket server
    await start_server(
        config.server_port,
        config.ws_secret,
        config.tls_key_file,
        config.tls_cert_file,
    );
};



//Print the 1st, 2nd and 3rd place for a game on the lobby server
async function print_winners(results) {
    //Joins a array of strings with comma except the last entry is joined with " and ".
    function and_join(list) {
        return [...list.slice(0, -2), list.slice(-2).join(" and ")].join(", ");
    }

    async function print(color, pos, result) {
        let players = and_join(lua_array(result.players));
        await lobby_server.rcon.send(
            `/sc game.print("[color=${color}]${pos}: ${players} with a score of ${result.score}.[/color]")`
        );
    }

    //Map list of result entries by their place
    let places = new Map(results.map(result => [result.place, result]));

    //Print gold, silver and bronze positions if they exist
    if (places.has(1)) { await print('#FFD700', "1st", places.get(1)); }
    if (places.has(2)) { await print('#C0C0C0', "2nd", places.get(2)); }
    if (places.has(3)) { await print('#CD7f32', "3rd", places.get(3)); }
}


//airtable event funcs
let removed_roles = async function (roles, name, server) {
    await server.rcon.send(`/interface
    Roles.unassign_player(
        '${name}',
        game.json_to_table('${JSON.stringify(roles)}'), 
        nil, 
        true, 
        true
    )`.replace(/\r?\n +/g, ' '));
};

let added_roles = async function (roles, name, server) {
    await server.rcon.send(`/interface
    Roles.assign_player(
        '${name}',
        game.json_to_table('${JSON.stringify(roles)}'), 
        nil, 
        true, 
        true
    )`.replace(/\r?\n +/g, ' '));
};

let player_roles_init = async function(players_roles, server) {
    await server.rcon.send(`/interface 
    Roles.override_player_roles(
        game.json_to_table('${JSON.stringify(players_roles)}')
    )`.replace(/\r?\n +/g, ' ')
    );
};
//server setup
async function server_connected(ip, server) {
    //telling the server if this the lobby
    await server.rcon.send(`/set_lobby ${server.is_lobby}`);

    //if the server is the lobby log it and continue as the lobby cant have games
    if (server.is_lobby) {
        console.log(`${ip} is the lobby. `);

    } else {
        //Set the ip of the lobby
        await server.rcon.send(`/interface global.servers = {lobby = '${lobby_ip}'}`);

        //Get all mini games the server can run
        let result = await server.rcon.send(`/interface return game.table_to_json(mini_games.available)`);

        //Remove the command complete line
        result = result.split('\n')[0];
        server.games = lua_array(JSON.parse(result));
    }
    server.player_roles_init = function(players_roles) {
        player_roles_init(players_roles, server).catch((err) => {
            console.error(err);
        });
    };
    server.added_roles = function(roles, name) {
        added_roles(roles, name, server).catch((err) => {
            console.error(err);
        });
    };
    server.removed_roles = function(roles, name) {
        removed_roles(roles, name, server).catch((err) => {
            console.error(err);
        });
    };
    airtable_events.on('init', server.player_roles_init);
    airtable_events.on('added_roles', server.added_roles);
    airtable_events.on('removed_roles', server.removed_roles);

    server.online = true;
    await update_lobby_server_list();
}

async function server_disconnected(ip, server) {
    server.online = false;
    server.game_running = null;
    airtable_events.removeListener('init', server.player_roles_init);
    airtable_events.removeListener('added_roles', server.added_roles);
    airtable_events.removeListener('removed_roles', server.removed_roles);
    console.log(airtable_events);
    await update_lobby_server_list();
}

async function update_lobby_server_list() {
    //Skip update if connection to lobby server is offline.
    if (!lobby_server.rcon.authenticated) {
        return;
    }

    let server_data = {
        lobby: lobby_ip,
    };
    let running_servers = {};

    //Add games for local servers.
    for (let [ip, server] of servers) {
        if (server.online) {
            if (server.game_running) {
                running_servers[ip] = server.game_running;
            } else {
                for (let game of server.games || []) {
                    (server_data[game] || (server_data[game] = [])).push(ip);
                }
            }
        }
    }

    //Add games for remote servers.
    for (let client_data of socket_to_client_data.values()) {
        for (let [ip, server] of Object.entries(client_data.servers)) {
            if (server.game_running) {
                running_servers[ip] = server.game_running;
            } else {
                for (let game of server.games) {
                    (server_data[game] || (server_data[game] = [])).push(ip);
                }
            }
        }
    }

    //Update servers on the lobby server.
    await lobby_server.rcon.send(`/interface
        global.servers = game.json_to_table('${JSON.stringify(server_data)}')
        global.running_servers = game.json_to_table('${JSON.stringify(running_servers)}')
        mini_games.server_list_updated()
    `.replace(/\r?\n +/g, ' '));
}

//Create WebSocket server and set up event handlers for it.
const wss = new WebSocket.Server({ noServer: true });
wss.on("connection", function(ws, request) {

    //Print the ip of the new connetion.
    console.log(`Received connection from ${request.socket.remoteAddress}`);

    let client_data = {
        servers: {},
    };

    socket_to_client_data.set(ws, client_data);

    let intervalt = setInterval(() => {
        ws.send(JSON.stringify({type: 'ping'}));
    }, 5000);

    //Signal the connection has been established and send lobby ip
    ws.send(JSON.stringify({
        "type": "connected",
        "lobby_ip": lobby_ip,
    }));

    if (airtable_init_done) {
        ws.send(JSON.stringify({
            "type": 'init_roles',
            "roles": player_roles,
        }));
    }
    ws.on("message", function(message) {
        on_message(client_data, JSON.parse(message)).catch(err => {
            console.log("Error handling message", err);
        });
    });

    //When the connection is closed print this.
    ws.on("close", function(code, reason) {
        console.log(`Connection from ${request.socket.remoteAddress} closed`);
        socket_to_client_data.delete(ws);
        clearInterval(intervalt);
        update_lobby_server_list().catch(err => {
            console.log("Error during ws close:", err);
        });
    });

    //Making sure and error does not crash the script
    ws.on("error", function(error) {
        console.error(error);
    });
});

//Function to see if the client has the right token.
function authenticate(request, secret) {
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


//Invoked when a message is received from a client
async function on_message(client_data, message) {
    console.log(`data recieved: ${JSON.stringify(message, null, 4)}`);

    //Check the key type of data to see what action to take
    if (message.type === "server_list") {
        client_data.servers = message.servers;
        await update_lobby_server_list();

    } else if (message.type === "stopped_game") {
        //If the game has ended print who has won in the lobby.
        //send it 10 sec
        setTimeout(function() {
            print_winners(lua_array(message.results)).catch(err => {
                console.log("error printing winners for remote game", err);
            });
        }, 10000);
    } else if (message.type === "player_count_changed") {
        let ip = message.ip;
        let amount = message.amount;
        await lobby_server.rcon.send(`/interface mini_games.set_online_player_count(${amount}, "${ip}") `);
    } else if (message.type === 'pong') {
        console.log('ping/pong succes');
    } else {
        console.log(`unkown message ${JSON.stringify(message)} from ${JSON.stringify(client_data)}`);
    }
}

//Start https server
async function start_server(port, secret, key_file, cert_file) {
    //Load JWT secret
    secret = Buffer.from(secret, "base64");

    let server = https.createServer({
        key: await fs.readFile(key_file),
        cert: await fs.readFile(cert_file),
    });

    //Handle WebSocket connections
    server.on("upgrade", function(request, socket, head) {
        if (!authenticate(request, secret)) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit("connection", ws, request);
        });
    });

    //Catch possible errors listening on port
    await new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, "0.0.0.0", () => {
            server.off("error", reject);
            console.log(`listening on ${port}`);
            resolve();
        });
    });
}