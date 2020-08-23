"use strict";
require('dotenv').config();
const fs = require('fs').promises;

/*eslint-disable no-process-env*/
const config = {
    airtable_token: process.env.Api_key,
    airtable_base: process.env.Base_key,
    is_server: process.env.Is_lobby.toLowerCase() === 'true',
    servers_file: process.env.Servers,

    //Server specific configs
    server_port: process.env.port,
    server_bind_ip: process.env.bind_ip || "0.0.0.0",
    ws_secret: process.env.secret,
    tls_key_file: process.env.key,
    tls_cert_file: process.env.cert, //May also be specified on the client

    //Client specific configs
    ws_token: process.env.token,
    ws_url: process.env.url,
};
/*eslint-enable no-process-env*/

const server = require('./server.js');
const client = require('./client.js');
const file_listener = require('./file_listener.js');
const rcon_connector = require('./rcon_connector.js');
const Airtable = require('airtable');
const {
    stopped_game, started_game, add_player,
    init: airtable_init,
} = require('./airtable.js');
const { lua_array, print_error } = require('./helpers.js');


const servers = new Map();
const base = new Airtable({ apiKey: config.airtable_token }).base(config.airtable_base);


class Server {
    constructor(ip, server_config) {
        this.dir = server_config.dir;
        this.Rcon_pass = server_config.Rcon_pass;
        this.Rcon_port = server_config.Rcon_port;
        this.ip = ip;
        this.online = false;
        this.games = [];
        this.game_running = null;
        this.is_lobby = Boolean(server_config.is_lobby);

        file_listener.watch_files(this);
        this.rcon = rcon_connector.connect_to_server(this);
    }

    async rcon_event(event) {
        if (event.type === "connect") {
            await client.server_connected(this);

        } else if (event.type === "close") {
            client.server_disconnected(this);
            console.log(`lost rcon connection with ${this.ip}`);

        } else {
            console.log(`unknown rcon_event ${event.type}`);
            console.log(JSON.stringify(event));
        }
    }

    async file_event(event) {
        if (event.type === "started_game") {
            console.log(event);
            let record_id = await started_game(base, event.name, lua_array(event.players));
            this.record_id = record_id;

        } else if (event.type === "start_cancelled") {
            this.game_running = null;
            await this.rcon.send('/sc game.print("Returning to lobby in 5 sec")');
            setTimeout(() => {
                this.rcon.send("/lobby_all").catch(print_error("send everyone back to lobby"));
            }, 5000);

            //In 20 sec kick all players
            setTimeout(() => {
                this.rcon.send("/kick_all").catch(print_error("kicking everyone out from server"));
            }, 20000);

            client.send_server_list();

        } else if (event.type === "start_game") {
            //Only the lobby can start games remotely
            if (!this.is_lobby) {
                console.log("Error: Recevied start_game from game server");
                return;
            }

            //log the argmunts
            console.log(`game arguments are ${JSON.stringify(event.args)}`);

            //Get the socket of the server
            let client_ws = server.find_socket_for_server_ip(event.server);

            //If the socket was found, send start game message to it
            if (client_ws) {
                client_ws.send(JSON.stringify(event));

            } else {
                console.log(`Error: Received start for unavailable server ${event.server}`);
            }

        } else if (event.type === "stopped_game") {
            this.game_running = null;
            if (this.record_id) {
                let record_id = this.record_id;
                this.record_id = null;
                await stopped_game(base, lua_array(event.results), record_id);

            } else {
                console.log(`Received stopped_game, but missing airtable record_id`);
                console.log(JSON.stringify(event));
            }

            //Send all players to lobby
            setTimeout(() => {
                this.rcon.send("/lobby_all").catch(print_error("sending /lobby_all"));
            }, 10000);

            //In 20 sec kick all players
            setTimeout(() => {
                this.rcon.send("/kick_all").catch(print_error("sending /kick_all"));
            }, 20000);

            client.send(JSON.stringify(event));
            client.send_server_list();

        } else if (event.type === "player_count_changed") {
            client.send(JSON.stringify({ "type": "player_count_changed", "amount": event.amount, "ip": this.ip}));

        } else if (event.type === "new_player") {
            console.log(`adding player ${event.name} and deleting ${event.path_to_file}`);
            await add_player(base, event.name);
            await fs.unlink(event.path_to_file);

        } else {
            console.log(`unknown file_event ${event.type}`);
            console.log(JSON.stringify(event));
        }
    }
}

function setup_local_connection() {
    let client_data = {
        servers: {},
    };

    let client_ws = {
        send: function(text) {
            client.on_message(JSON.parse(text)).catch(
                print_error("handling message from local server")
            );
        },
    };

    let server_ws = {
        send: function(text) {
            server.on_message(client_data, JSON.parse(text)).catch(
                print_error("handling message from local client")
            );
        },
    };

    client.connect_local_server(server_ws);
    server.connect_local_client(client_ws, client_data);
}

async function start() {
    const content = await fs.readFile(config.servers_file);
    const server_configs = new Map(Object.entries(JSON.parse(content)));

    let lobby_servers = [];
    for (let [ip, server_config] of server_configs) {
        if (server_config.is_lobby) {
            lobby_servers.push(ip);
        }
        servers.set(ip, new Server(ip, server_config));
    }

    if (config.is_server && lobby_servers.length !== 1) {
        throw new Error(`Excepted there to be exactly one lobby server but got ${lobby_servers.length}`);
    } else if (!config.is_server && lobby_servers.length !== 0) {
        throw new Error(`Remote client cannot have the lobby server`);
    }
    let lobby_server = servers.get(lobby_servers[0]);

    await client.init(config, servers);

    if (config.is_server) {
        await server.init(config, lobby_server);
        setup_local_connection();
        await airtable_init(base);
    }
}

if (require.main === module) {
    start().catch(err => {
        console.error(err);
        //eslint-disable-next-line no-process-exit
        process.exit(1);
    });
}