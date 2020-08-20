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

const side = require(config.is_server ? "./server.js" : "./client.js");
const file_listener = require('./file_listener.js');
const rcon_connector = require('./rcon_connector.js');
const Airtable = require('airtable');


async function start() {
    const content = await fs.readFile(config.servers_file);
    const servers = new Map(Object.entries(JSON.parse(content)));
    const base = new Airtable({ apiKey: config.airtable_token }).base(config.airtable_base);

    const file_events = file_listener.watch_files(servers);
    const rcon_events = rcon_connector.connect_to_servers(servers);

    for (let server of servers.values()) {
        server.games = [];
        server.online = false;
        server.game_running = null;
        server.is_lobby = Boolean(server.is_lobby);
    }

    await side.init(config, servers, base, file_events, rcon_events);
}

if (require.main === module) {
    start().catch(err => {
        console.error(err);
        //eslint-disable-next-line no-process-exit
        process.exit(1);
    });
}