"use strict";
const fs = require("fs").promises;
const https = require("https");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");

const { started_game, end_game } = require('./airtable.js');


let socket_to_client_data = new Map();
let lobby_server;
let lobby_ip;
let servers;
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
        server_connected(ip, server).catch(err => {
            console.log(`Error setting up rcon connection to ${ip}:`, err);
        });
    });

    rcon_events.on("close", function(ip, server) {
        server_disconnected(ip, server);
        console.log(`lost rcon connection with ${ip}`);
    });

    //when the Started_game game event is run in file_listener this function will run
    file_events.on("Started_game", async function(server, object) {

        //Setting the airtable things (this returns an id which the other server needs)
        let record_id = await started_game(base, object);

        //Adding the name to beiging of the args
        object.arguments.unshift(object.name);

        //setting the args and server parms
        const args = object.arguments.join(' ');
        const ip = object.server;

        //log the argmunts
        console.log(`game arguments are ${JSON.stringify(args)}`);

        //Checking if the server is local
        if (servers.has(ip)) {
            let target_server = servers.get(ip);
            target_server.record_id = record_id;

            //wait 30 sec the start the game
            setTimeout(async function() {
                if (target_server.rcon.authenticated) {
                    await target_server.rcon.send(`/start ${args}`);

                } else {
                    console.log(`Received start for unavailable server ${ip}`);
                }
            }, 30000);

        } else {
            //Get the socket of the server
            let ws;
            for (let [client_ws, client_data] of socket_to_client_data) {
                if (client_data.servers[ip]) {
                    ws = client_ws;
                    break;
                }
            }

            //If the socket was found, send start game message to it
            if (ws) {
                ws.send(JSON.stringify({
                    "type": "start_game",
                    "args": args,
                    "server": ip,
                    "record_id": record_id,
                }));

            } else {
                console.log(`Received start for unavailable server ${ip}`);
            }
        }
    });

    file_events.on("end_game", async function(server, object) {
        if (server.record_id) {
            let record_id = server.record_id;
            server.record_id = null;
            await end_game(base, object, record_id);

        } else {
            console.log(`Received end_game, but missing airtable record_id`);
            console.log(JSON.stringify(object));
        }

        //Send the stop command
        await server.rcon.send("/stop_games");

        //In 10 sec kick all players
        setTimeout(async function() {
            await server.rcon.send("/kick_all");
        }, 10000);

        //In 10 sec also print all the scores
        setTimeout(function() {
            print_winners(object).catch(err => {
                console.log("error printing winners for local game", err);
            });
        }, 10000);
    });

    //start the HTTPS/WebSocket server
    await start_server(
        config.server_port,
        config.ws_secret,
        config.tls_key_file,
        config.tls_cert_file,
    );
};

//Print the 1st, 2nd and 3rd place for a game on the lobby server
async function print_winners(object) {
    async function print(color, pos, player, score) {
        await lobby_server.rcon.send(
            `/sc game.print("[color=${color}]${pos}: ${player} with a score of ${score}.[/color]")`
        );
    }

    //Print gold, silver and bronze positions if they exist
    if (object.Gold) { await print('#FFD700', "1st", object.Gold, object.Gold_data); }
    if (object.Silver) { await print('#C0C0C0', "2nd", object.Silver, object.Silver_data); }
    if (object.Bronze) { await print('#cd7f32', "3rd", object.Bronze, object.Bronze_data); }
}

//server setup
async function server_connected(ip, server) {
    //telling the server if this the lobby
    await server.rcon.send(`/set_lobby ${server.is_lobby}`);

    //telling the server its own ip
    await server.rcon.send(`/set_server_address ${ip}`);

    //if the server is the lobby log it and continue as the lobby cant have games
    if (server.is_lobby) {
        console.log(`${ip} is the lobby. `);

    } else {
        //Set the ip of the lobby
        await server.rcon.send(`/interface global.servers = {lobby = '${lobby_ip}'}`);

        //Get all mini games the server can run
        let result = await server.rcon.send(`/interface
            local result = {}
            for name, mini_game in pairs(mini_games.mini_games) do
                if game.surfaces[mini_game.map] then
                    result[name] = true
                end
            end
            return game.table_to_json(result)`.replace(/\r?\n +/g, ' ')
        );

        //Remove the command complete line
        result = result.split('\n')[0];
        server.games = Object.keys(JSON.parse(result));
    }

    server.online = true;
    await update_lobby_server_list();
}

async function server_disconnected(ip, server) {
    server.online = false;
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

    //Add games for local servers.
    for (let [ip, server] of servers) {
        if (server.online) {
            for (let game of server.games || []) {
                (server_data[game] || (server_data[game] = [])).push(ip);
            }
        }
    }

    //Add games for remote servers.
    for (let client_data of socket_to_client_data.values()) {
        for (let [ip, server] of Object.entries(client_data.servers)) {
            for (let game of server.games) {
                (server_data[game] || (server_data[game] = [])).push(ip);
            }
        }
    }

    //Update servers on the lobby server.
    await lobby_server.rcon.send(`/interface global.servers = game.json_to_table('${JSON.stringify(server_data)}')`);
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

    //Signal the connection has been established and send lobby ip
    ws.send(JSON.stringify({
        "type": "connected",
        "lobby_ip": lobby_ip,
    }));

    ws.on("message", function(message) {
        on_message(client_data, JSON.parse(message)).catch(err => {
            console.log("Error handling message", err);
        });
    });

    //When the connection is closed print this.
    ws.on("close", function(code, reason) {
        console.log(`Connection from ${request.socket.remoteAddress} closed`);
        socket_to_client_data.delete(ws);

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

    } else if (message.type === "end_game") {
        //If the game has been ended print who has won in the lobby.
        //send it 10 sec
        setTimeout(function() {
            print_winners(message.data).catch(err => {
                console.log("error printing winners for remote game", err);
            });
        }, 10000);
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