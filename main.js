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
    auto_games_file: process.env.auto_games,

    //Client specific configs
    ws_token: process.env.token,
    ws_url: process.env.url,
};
/*eslint-enable no-process-env*/

const server = require('./server.js');
const client = require('./client.js');
const Airtable = require('airtable');
const { FactorioServer } = require('./factorio_server.js');
const { set_base, init: airtable_init } = require('./airtable.js');
const { print_error } = require('./helpers.js');

set_base(new Airtable({ apiKey: config.airtable_token }).base(config.airtable_base));


const servers = new Map();


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
    let auto_games;
    if (config.auto_games_file) {
        auto_games = await fs.readFile(config.auto_games_file);
        auto_games = JSON.parse(auto_games);
        console.log(`${auto_games}`);
        config.auto_games = auto_games;
        delete config.auto_games_file;
    }
    const server_configs = new Map(Object.entries(JSON.parse(content)));

    let lobby_servers = [];
    for (let [ip, server_config] of server_configs) {
        if (server_config.is_lobby) {
            lobby_servers.push(ip);
        }
        servers.set(ip, new FactorioServer(ip, server_config));
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
        await airtable_init();
    }
}

if (require.main === module) {
    start().catch(err => {
        console.error(err);
        //eslint-disable-next-line no-process-exit
        process.exit(1);
    });
}