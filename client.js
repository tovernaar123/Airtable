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
        var rcon = local_rcons[object.server];
        await rcon.send("/stop_games");
        setTimeout(async function() {
            await rcon.send("/kill_all");
        }, 5000);
        websocket.send(JSON.stringify({ "type": "end_game", "data": object }));
    });
    file_events.on("Started_game", async function(object) {
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
        port: 1
    };
    if (cert) {
        options.ca = cert;
    }
    if (/(\d+\.){3}\d+/.test(new URL(process.env.url).hostname)) {
        // Overzealous ws lib adds SNI for IP hosts.
        options.servername = "";
    }
    let ws = new WebSocket(process.env.url, options);
    ws.on("open", function() {
        ws.send(JSON.stringify({ "id": "expgaming" }));
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
            for (let name in servers.local_servers) {

                //Get the open rcon connections
                const rcon = local_rcons[name];

                //Set the lobby
                await rcon.send(`/interface global.servers = {lobby = '${lobby}'}`);
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


async function server_setup() {
    //object for storing the games
    var object_for_lua = {};

    //check all local server
    for (let variable in servers["local_servers"]) {

        //Get the object from the locals servers
        const object = servers["local_servers"][variable];

        //Get the open rcon connection
        const rcon = local_rcons[variable];

        //Get the lobby key
        const is_lobby = object.is_lobby;

        //Check if someting has goan wrong
        if (is_lobby == true) { throw new Error('client cant have the lobby server'); }

        //Get the ip:prort of the server
        const ip = variable;

        //Set the lobby to false cuase it shood not be true (and could be undefined so shood just be false).
        await rcon.send(`/set_lobby false`);

        //Set the ip:port of the server so the server know who it is.
        await rcon.send(`/set_server_address ${ip}`);

        let result;

        //Get all the maps on the server
        result = await rcon.send('/interface local result = {} for i , surface in pairs(game.surfaces) do result[surface.name] = true end return game.table_to_json(result)');
            //Remove the command complete line
        result = result.split('\n')[0];
        const maps = JSON.parse(result);

        //Get all mini_games on the server (these are not all the games the server can run)
        result = await rcon.send('/interface local result = {} for name,mini_game in pairs(mini_games.mini_games)do result[mini_game.map] = name end return game.table_to_json(result)');
            //Remove the command complete line
        result = result.split('\n')[0];
        const games = JSON.parse(result);

        //just for print the games
        let game_for_debug = [];

        //Compare the maps with the games where they match put them in games and object_for_lua
        for (let name in games) {
            //Check if the server has the map
            if (maps[name] != undefined) {

                //Get internal_name name of the game
                let internal_name = games[name];

                //If the array does not exsit yet create it 
                if (object_for_lua[internal_name] == undefined) { object_for_lua[internal_name] = []; }

                //Push the the variable or the ip:prot of the server (which is top for loop var) to object_for_lua
                object_for_lua[internal_name].push(variable);

                //And push it to game_for_debug so it can printed
                game_for_debug.push(internal_name);
            }
        }

        //Just put and between the games (cause i am to lazzy to make it a good sentence).
        game_for_debug = game_for_debug.join(' and ');

        //And print ofc.
        console.log(`${variable} is running ${game_for_debug}. `);
    }

    //Send the object to the server so it can tell the lobby what these servers is running.
    websocket.send(JSON.stringify({ "type": 'server_object', "data": object_for_lua }));
}