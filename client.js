"use strict";
let local_rcons;
const WebSocket = require("ws");
const fs = require("fs").promises;
const servers = JSON.parse((process.env.Servers));
const { end_game } = require('./airtable.js');
let websocket;
let id;
exports.init = async function(local_rcons_, file_events) {
    local_rcons = local_rcons_;
    await client();
    await server_setup();
    file_events.on("end_game", async function(object) {
        await end_game(object, id);
        let rcon = local_rcons[object.server];
        await rcon.send("/stop_games");
        setTimeout(async function() {
            await rcon.send("/kick_all");
        }, 5000);
        websocket.send(JSON.stringify({ "type": "end_game", "data": object }));
    });
    file_events.on("Started_game", function(object) {
        console.error('cant start game withouth the lobby');
    });
};


let reconnecting = false;
let interval_token;

//magic func dont touch
async function client() {
    let cert = await fs.readFile(process.env.cert);

    let options = {
        headers: { "Authorization": process.env.token },
        port: 1,
    };
    if (cert) {
        options.ca = cert;
    }
    if (/(\d+\.){3}\d+/.test(new URL(process.env.url).hostname)) {
        //Overzealous ws lib adds SNI for IP hosts.
        options.servername = "";
    }
    let ws = new WebSocket(process.env.url, options);
    ws.on("open", function() {
        if (reconnecting) {
            clearInterval(interval_token);
        }
    });
    ws.on("message", function(msg) {
        ondata(msg);
    });
    ws.on("error", function(error) {
        if (reconnecting) {
            console.log("cant reconnect try again in 10 sec");
        } else {
            console.error(error);
        }
    });
    ws.on("close", function() {
        console.log("Connection lost");
        if (!reconnecting) {
            interval_token = setInterval(function() {
                client();
            }, 10000);
        }
        reconnecting = true;
    });
    websocket = ws;
}

//The func ran when their is data send to the client
async function ondata(msg) {
    let data = JSON.parse(msg);
    console.log(`data recieved: ${JSON.stringify(data)}`);

    //the data type sets what is going the happen
    switch (data.type) {
        case "start":
            let args = data.args;

            //Join the arguments so it can be run with /start
            args = args.join(' ');

            //get the open rcon to this server
            let rcon = local_rcons[data.sever];

            //wait 30 sec then /start the game with the arguments
            setTimeout(async function() {
                await rcon.send(`/start ${args}`);
            }, 30000);

            //set the id to the data id
            id = data.id;

            //break so default is not ran
            break;
        case 'lobby_set':
            //lobby is the ip:port of the lobby server
            let lobby = data.data;

            //loop over all the local server and set the lobby
            for (let name of Object.keys(servers.local_servers)) {

                //Get the open rcon connections
                let rcon_ = local_rcons[name];

                //Set the lobby
                await rcon_.send(`/interface global.servers = {lobby = '${lobby}'}`);
                console.log(`${lobby} is the lobby.`);
            }

            //break so default is not ran
            break;
        default:
            //If type is connected just print Connected to server
            if (data.type === "connected") { console.log("Connected to server."); return; }

            //Else print that the type makes no sence
            console.log(`Unkown type ${data.type}`);
            break;
    }
}
function rcon_end(game_for_crash, variable) {
    websocket.send(JSON.stringify({ "type": 'sever_disconnect', "data": [game_for_crash, variable] }));
}

async function server_setup() {
    //object for storing the games
    var object_for_lua = {};

    //check all local server
    for (let [ip, server] of Object.entries(servers["local_servers"])) {

        //Get the open rcon connection
        const rcon = local_rcons[ip];

        //Get the lobby key
        const is_lobby = server.is_lobby;

        //Check if someting has goan wrong
        if (is_lobby === true) { throw new Error('client cant have the lobby server'); }

        //Set the lobby to false cuase it shood not be true (and could be undefined so shood just be false).
        await rcon.send(`/set_lobby false`);

        //Set the ip:port of the server so the server know who it is.
        await rcon.send(`/set_server_address ${ip}`);

        let result;

        //Get all the maps on the server
        //eslint-disable-next-line max-len
        result = await rcon.send('/interface local result = {} for i , surface in pairs(game.surfaces) do result[surface.name] = true end return game.table_to_json(result)');
        //Remove the command complete line
        result = result.split('\n')[0];
        const maps = JSON.parse(result);

        //Get all mini_games on the server (these are not all the games the server can run)
        //eslint-disable-next-line max-len
        result = await rcon.send('/interface local result = {} for name,mini_game in pairs(mini_games.mini_games)do result[mini_game.map] = name end return game.table_to_json(result)');

        //Remove the command complete line
        result = result.split('\n')[0];
        const games = JSON.parse(result);

        //just for print the games
        let game_for_crash = [];

        //Compare the maps with the games where they match put them in games and object_for_lua
        for (let name in games) {
            //Check if the server has the map
            if (maps[name]) {

                //Get internal_name name of the game
                let internal_name = games[name];

                //If the array does not exsit yet create it
                if (object_for_lua[internal_name] === undefined) { object_for_lua[internal_name] = []; }

                //Push the the the ip:prot of the server (which is top for loop var) to object_for_lua
                object_for_lua[internal_name].push(ip);

                //And push it to game_for_debug so it can printed
                game_for_crash.push(internal_name);
            }
        }
        rcon.on('end', rcon_end(game_for_crash, variable));
        rcon.on('error', (err) => { console.error(err); });
    }

    //Send the object to the server so it can tell the lobby what these servers is running.
    websocket.send(JSON.stringify({ "type": 'server_object', "data": object_for_lua }));
}