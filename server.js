"use strict";
const fs = require("fs").promises;
const https = require("https");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
let config;
const { airtable_events, player_roles } = require('./airtable.js');
const { lua_array, print_error } = require('./helpers.js');

let socket_to_client_data = new Map();
let lobby_server;
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

let game_schedule = [];

airtable_events.once('recieved_game_schedule', (games) => {
    game_schedule = games;
    let utc_time = new Date();
    let timeout = game_schedule[0].date - utc_time;
    if (timeout < 0) { timeout = 0; };
    setTimeout(() => {
        let amount_of_games = game_schedule[0].amount_of_games;
        let required_players = game_schedule[0].required_players;
        let game = game_schedule[0].game;
        start_new_game(amount_of_games, required_players, game);
    }, timeout);
}, 1000);

exports.init = async function init(_config, init_lobby_server) {
    console.log("running as server");
    lobby_server = init_lobby_server;
    config = _config;
    //Find the lobby server among the local servers.
    //start the HTTPS/WebSocket server
    await start_server(
        config.server_port,
        config.server_bind_ip,
        config.ws_secret,
        config.tls_key_file,
        config.tls_cert_file,
    );
};

exports.connect_local_client = function connect_local_client(client_ws, client_data) {
    socket_to_client_data.set(client_ws, client_data);

    //Signal the connection is established and send lobby ip
    client_ws.send(JSON.stringify({
        "type": "connected",
        "lobby_ip": lobby_server.ip,
    }));
};

function find_socket_for_server_ip(ip) {
    for (let [client_ws, client_data] of socket_to_client_data) {
        if (client_data.servers[ip]) {
            return client_ws;
        }
    }
    return null;
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


async function update_lobby_server_list() {
    //Skip update if connection to lobby server is offline.
    if (!lobby_server.rcon.authenticated) {
        return;
    }

    let server_data = {
        lobby: lobby_server.ip,
    };
    let running_servers = {};

    //Add games for servers.
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

    let ping_interval = setInterval(() => {
        ws.ping();
    }, 5000);

    //Signal the connection has been established and send lobby ip
    ws.send(JSON.stringify({
        "type": "connected",
        "lobby_ip": lobby_server.ip,
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
        clearInterval(ping_interval);
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

function getRandomInt(max) {
    return Math.floor(Math.random() * Math.floor(max));
}

let _amount_of_games;
let _required_players;
let _game;
async function start_new_game(amount_of_games, required_players, game) {
    if (amount_of_games <= 0) { return; }
    _amount_of_games = amount_of_games;
    _required_players = required_players;
    _game = game;
    let game_array = config.auto_games[game];
    let online_players = await lobby_server.rcon.send(`/interface 
        return #Roles.get_role_by_name('Participant'):get_players(true)`.replace(/\r?\n +/g, ' '));
    online_players = online_players.replace(/\r?\n +/g, '');
    online_players = online_players.replace('Command Complete', '');
    if (Number(online_players) >= required_players) {
        let command = game_array[getRandomInt(game_array.length)];
        setTimeout(() => {
            lobby_server.rcon.send(`/interface ${command}`)
                .then(() => {
                    amount_of_games = amount_of_games - 1;
                    _amount_of_games = amount_of_games;
                    if (amount_of_games === 0) {
                        if (game_schedule.length <= 0) {
                            return;
                        }
                        game_schedule.shift();
                        let utc_time = new Date();
                        let timeout = game_schedule[0].date - utc_time;
                        if (timeout < 0) { timeout = 0; };
                        setTimeout(() => {
                            amount_of_games = game_schedule[0].amount_of_games;
                            required_players = game_schedule[0].required_players;
                            game = game_schedule[0].game;
                            start_new_game(amount_of_games, required_players, game);
                        }, timeout);
                    }
                })
                .catch(print_error('called in start_new_game'));
        }, 25000);
    } else {
        let Intervalt = setInterval(() => {
            lobby_server.rcon.send(`/interface 
                return #Roles.get_role_by_name('Participant'):get_players(true)`.replace(/\r?\n +/g, ' '))
                .then((online_count) => {
                    online_count = online_count.replace(/\r?\n +/g, '');
                    online_count = online_count.replace('Command Complete', '');
                    if (Number(online_count) >= required_players) {
                        clearInterval(Intervalt);
                        let command = game_array[getRandomInt(game_array.length)];
                        lobby_server.rcon.send(`/interface ${command}`)
                            .then(() => {
                                amount_of_games = amount_of_games - 1;
                                _amount_of_games = amount_of_games;
                                if (amount_of_games === 0) {
                                    if (game_schedule.length <= 0) {
                                        return;
                                    }
                                    game_schedule.shift();
                                    let utc_time = new Date();
                                    let timeout = game_schedule[0].date - utc_time;
                                    if (timeout < 0) { timeout = 0; };
                                    setTimeout(() => {
                                        amount_of_games = game_schedule[0].amount_of_games;
                                        required_players = game_schedule[0].required_players;
                                        game = game_schedule[0].game;
                                        start_new_game(amount_of_games, required_players, game);
                                    }, timeout);
                                }
                            })
                            .catch(print_error('called in start_new_game'));
                    }
                });
        }, 5000);
    }
}


//Invoked when a message is received from a client
async function on_message(client_data, message) {
    console.log(`data recieved: ${JSON.stringify(message, null, 4)}`);

    //Check the key type of data to see what action to take
    if (message.type === "server_list") {
        client_data.servers = message.servers;
        await update_lobby_server_list();

    } else if (message.type === "start_game") {
        //Get the socket of the server
        let client_ws = find_socket_for_server_ip(message.server);

        //If the socket was found, send start game message to it
        if (client_ws) {
            client_ws.send(JSON.stringify(message));

        } else {
            console.log(`Error: Received start for unavailable server ${message.server}`);
        }

    } else if (message.type === "stopped_game") {
        //If the game has ended print who has won in the lobby.
        //send it 10 sec
        setTimeout(function() {
            print_winners(lua_array(message.results)).catch(err => {
                console.log("error printing winners for remote game", err);
            });
        }, 10000);
        start_new_game(_amount_of_games, _required_players, _game)
            .catch(print_error('when trying to start a new game'));
    } else if (message.type === "player_count_changed") {
        let ip = message.ip;
        let amount = message.amount;
        await lobby_server.rcon.send(`/interface mini_games.set_online_player_count(${amount}, "${ip}") `);
    } else {
        console.log(`unkown message ${JSON.stringify(message)} from ${JSON.stringify(client_data)}`);
    }
}
exports.on_message = on_message;

//Start https server
async function start_server(port, bind_ip, secret, key_file, cert_file) {
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
        server.listen(port, bind_ip, () => {
            server.off("error", reject);
            console.log(`listening on ${port}`);
            resolve();
        });
    });
}