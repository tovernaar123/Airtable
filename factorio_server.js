"use strict";
const client = require('./client.js');
const file_listener = require('./file_listener.js');
const rcon_connector = require('./rcon_connector.js');
const { stopped_game, started_game, add_player } = require('./airtable.js');
const { lua_array, print_error } = require('./helpers.js');

class FactorioServer {
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
            let record_id = await started_game(event.name, lua_array(event.players));
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
            client.send(JSON.stringify(event));

        } else if (event.type === "stopped_game") {
            this.game_running = null;
            if (this.record_id) {
                let record_id = this.record_id;
                this.record_id = null;
                await stopped_game(lua_array(event.results), record_id);

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
            await add_player(event.name);
            await fs.unlink(event.path_to_file);

        } else {
            console.log(`unknown file_event ${event.type}`);
            console.log(JSON.stringify(event));
        }
    }
}
exports.FactorioServer = FactorioServer;