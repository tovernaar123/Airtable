"use strict";

var servers = JSON.parse((process.env.Servers));
const fs = require("fs").promises;
const https = require("https");
//const util = require("util");

const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
let server_ip_to_socket = new Map();
var secret;
let lobby_rcon
let local_rcons
let id
const { Started_game, end_game } = require('./airtable.js')

//server setup 
async function server_setup() {
    var object_for_lua = {}
    for (let variable in servers["local_servers"]) {
        //use await cause its still connecting
        const rcon = local_rcons[variable]
        const object = servers["local_servers"][variable]
        const is_lobby = object.is_lobby
        const ip = variable

        //telling the server if this the lobby
        await rcon.send(`/set_lobby ${is_lobby}`)

        //telling the server its own ip
        await rcon.send(`/set_server_address ${ip}`)

        //if the server is the lobby log it and continue as the lobby cant have games
        if (is_lobby == true) {
            console.log(`${variable} is the lobby. `)
            object_for_lua['lobby'] = variable
            continue
        }

        let result

        //getting all surface on the server
        result = await rcon.send('/interface local result = {} for i , surface in pairs(game.surfaces) do result[surface.name] = true end return game.table_to_json(result)')
        result = result.split('\n')[0]
        const json1 = JSON.parse(result)

        //getting all mini_games on the server
        result = await rcon.send('/interface local result = {} for name,mini_game in pairs(mini_games.mini_games)do result[mini_game.map] = name end return game.table_to_json(result)')
        result = result2.split('\n')[0]
        const json2 = JSON.parse(result)

        let games = []

        //checking what the server is running by checking the maps against the games
        for (let name in json2) {
            if (json1[name] != undefined) {
                var internal_name = json2[name]
                if (object_for_lua[internal_name] == undefined) { object_for_lua[internal_name] = [] }
                object_for_lua[internal_name].push(variable)
                games.push(internal_name)
            }
        }
        //just some printing for debbuging 
        games = games.join(' and ')
        console.log(`${variable} is running ${games}. `)
    }

    //return all running servers
    const result = lobby_rcon.send(`/interface return game.table_to_json(global.servers)`)

    //Combine result with object_for_lua.
    for (let [key, value] of Object.entries(result)) {
        //If the key is lobby set lobby to the value as push will throw an error.
        if (key == 'lobby') {
            object_for_lua['lobby'] = value
            continue
        }
        //If the key is their add the value
        if (object_for_lua[key]) {

            //All keys (beside lobby ) are an array so we can push the value in to this array.
            object_for_lua[key].push(...value);
        } else {
            //if key is not their just set it to value
            object_for_lua[key] = value;
        }
    }

    //The lua can only read Json so lets make it json.
    var json = JSON.stringify(object_for_lua)

    //Wait for the server to send the object
    await lobby_rcon.send(`/interface global.servers= game.json_to_table('${json}')`)
    console.log(object_for_lua)
}



//function called by main where lobby_rcon_ is the open rcon to the lobby and local_rcons_ is all the rcon connections including the lobby.
//file_events is the events the run when the files change
exports.init = async function(lobby_rcon_, local_rcons_, file_events) {
    console.log("running as server")

    //setting file variables to the parms
    lobby_rcon = await lobby_rcon_
    local_rcons = await local_rcons_

    //starting the server
    await start()

    //server setup 
    await server_setup()

    //when the Started_game game event is run in file_listener this function will run
    file_events.on("Started_game", async function(object) {

        //Setting the airtable things (this returns an id which the other server needs)
        id = await Started_game(object)

        //Adding the name to beiging of the args
        object.arguments.unshift(object.name)

        //setting the args and server parms
        const args = object.arguments
        const server = object.server

        //log the argmunts
        console.log(`game arguments are ${JSON.stringify(args)}`)

        //Checking if the server is local
        if (servers["local_servers"][server] != undefined) {

            //Join the args to then run /start 
            args = args.join(' ')

            //get the open rcon connection
            let rcon2 = local_rcons[server]

            //wait 30 sec the start the game
            setTimeout(async function() {
                await rcon2.send("/start " + args)
            }, 30000)
        } else {
            //Get the socket of the server
            let socket = server_ip_to_socket.get(server);


            //If no socket error
            if (socket === undefined) { console.error("cant find server"); return }

            //If their is a socket send the socket the args and the airtable_id
            socket.send(JSON.stringify({ "type": "start", "args": args, "sever": server, "id": id }));
        }
    });
    file_events.on("end_game", async function(object) {
        await end_game(object, id)

        //Geting server ip 
        const server = object.server

        //Getting open rcon connection
        let rcon = local_rcons[server]

        //Send the stop command
        await rcon.send("/stop_games")

        //In 10 sec kick all players
        setTimeout(async function() {

            //The command is kill_all 
            await rcon.send("/kill_all")
        }, 10000)

        //In 10 sec also print all the scores
        setTimeout(async function() {

            //Get the lobby rcon
            let rcon2 = lobby_rcon

            //Print the gold data and the player name
            await rcon2.send("/sc game.print( \"[color=#FFD700]1st: " + object.Gold + " with a score of " + object.Gold_data + ".[/color]\")")

            //If their is a silver player print it 
            if (object.Silver != undefined) {
                await rcon2.send("/sc game.print( \"[color=#C0C0C0]2nd: " + object.Silver + " with a score of " + object.Silver_data + ".[/color]\")")

                //If their is a Bronze player print it
                if (object.Bronze != undefined) {
                    await rcon2.send("/sc game.print(\"[color=#cd7f32]3rd:" + object.Bronze + " with a score of" + object.Bronze_data + ".[/color]\")")
                }
            }
        }, 10000)
    });

};
//Creating a new server and setting the event handlers.
const wss = new WebSocket.Server({ noServer: true });
wss.on("connection", function(ws, request) {
    //Print the ip of the new connetion.
    console.log(`Received connection from ${request.socket.remoteAddress}`);

    //Send back to the client that everything has worked.
    ws.send(JSON.stringify({ "type": "connected" }));

    //Run ondata when data comes in 
    ws.on("message", async function(msg) {
        ondata(msg, ws)
    });

    //When the connection is closed print this.
    ws.on("close", function(code, reason) {
        console.log(`Connection from ${request.socket.remoteAddress} closed`);
        for (let [server_ip, socket] of server_ip_to_socket) {
            if (socket === ws) {
                server_ip_to_socket.delete(server_ip);
            }
        }
    });

    //Making sure and error does not crash the script
    ws.on("error", function(error) {
        console.error(error)
    })

});

//Function to see if the client has the right token.
function authenticate(request) {
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

//Function ran when data is send to the server
async function ondata(msg, ws) {
    let data

    //try decode data to json
    try {
        data = JSON.parse(msg);
    } catch (e) {
        console.error(e)
    }

    //check the key type of data to see what action to take 
    if (data.type === "server_object") {
        //if type is server_object it means that the client has send the mini_games its running 
        var object_for_lua = data.data

        //get the all the current games to combine with the games of this client 
        var result = await lobby_rcon.send(`/interface return game.table_to_json(global.servers)`)
        result = JSON.parse(result.split('\n')[0])
        for (let [key, server_ips] of Object.entries(data.data)) {
            server_ips.map(ip => server_ip_to_socket.set(ip, ws));
        }
        //combine both of the objects into 1 
        for (let [key, value] of Object.entries(result)) {
            if (object_for_lua[key]) {
                object_for_lua[key].push(...value);
            } else {
                object_for_lua[key] = value;
            }
        }
        console.log(object_for_lua)

        //reply back to the client the lobby ip:port
        var json = JSON.stringify(object_for_lua)
        var json2 = {}
        json2.type = 'lobby_set'
        json2.data = object_for_lua.lobby
        ws.send(JSON.stringify(json2))

        //set the servers global to object_for_lua
        lobby_rcon.send(`/interface global.servers= game.json_to_table('${json}')`)
        return
    } else {
        //If the game has been ended print who has won in the lobby.
        if (data.type === "end_game") {
            //send it 10 sec
            setTimeout(async function() {
                let rcon = lobby_rcon
                await rcon.send("/sc game.print( \"[color=#FFD700]1st: " + object.Gold + " with a score of " + object.Gold_data + ".[/color]\")")
                if (object.Silver != undefined) {
                    await rcon.send("/sc game.print( \"[color=#C0C0C0]2nd: " + object.Silver + " with a score of " + object.Silver_data + ".[/color]\")")
                    if (object.Bronze != undefined) {
                        await rcon.send("/sc game.print(\"[color=#cd7f32]3rd:" + object.Bronze + " with a score of" + object.Bronze_data + ".[/color]\")")
                    }
                }
            }, 10000)
        }
    }
    console.log("got data")
    console.log(data);
}

//do not touch funtion just leave it here and all will be good.
async function start() {
    //let bytes = await util.promisify(crypto.randomBytes)(256);
    //bytes.toString("base64")
    //token: jwt.sign({}, bytes)

    //Magic code dont touch (dont fix it if it aint broke).
    secret = Buffer.from(process.env.secret, "base64");
    let server = https.createServer({
        key: await fs.readFile(process.env.key),
        cert: await fs.readFile(process.env.cert),
    });

    server.on("upgrade", function(request, socket, head) {
        if (!authenticate(request)) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, function done(ws) {
            wss.emit("connection", ws, request);
        });
    });

    await new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(process.env.port, "0.0.0.0", () => {
            server.off("error", reject);
            console.log(`listening on ${process.env.port}`);
            resolve();
        });
    });
}