
var result = require('dotenv').config()
var variables = result.parsed
global.key  = variables.Api_key
servers =  JSON.parse((variables.Servers))
global.servers = servers
require(__dirname + "\\file_listener.js")

Rcon = require("rcon-client").Rcon
async function connect_rcon(port,pw){
    const rcon = new Rcon({ host: "localhost", port: port, password: pw })
    await rcon.connect()
    return rcon
}

//rcon2.send("hi")
//rcon.send("hi")

const crypto = require("crypto");
const fs = require("fs").promises;
const https = require("https");
const util = require("util");

const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
var sockets = {}
var server;
if(variables.Is_lobby === "true"){
    console.log("running as server")
    var config;
    var secret;
    const wss = new WebSocket.Server({ noServer: true });
    wss.on("connection", function(ws, request) {
        console.log(`Received connection from ${request.socket.remoteAddress}`);
        ws.send(JSON.stringify({"type": "connected"}));
        ws.on("message", function(msg) {
            let data = JSON.parse(msg);
            if(data.id != undefined){
                sockets[data.id] = ws
            }else{
                if(data.type === "end_game"){
                    print_who_won(data["data"].object)
                }
            }
            console.log("got data")
            console.log(data);
        });

        ws.on("close", function(code, reason) {
            console.log(`Connection from ${request.socket.remoteAddress} closed`);
        });
    });

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


    async function start() {
        //let bytes = await util.promisify(crypto.randomBytes)(256);
        //bytes.toString("base64")
        //token: jwt.sign({}, bytes)
        secret = Buffer.from(variables.secret, "base64")
        let server = https.createServer({
            key: await fs.readFile(variables.key),
            cert: await fs.readFile(variables.cert),
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
            server.listen(variables.port,"0.0.0.0", () => {
                server.off("error", reject);
                console.log(`listening on ${variables.port}`);
                resolve();
            });
        });
    }

    if (require.main === module) {
        start().catch(err => {
            console.error(err);
            process.exitCode = 1;
        });
    }
}else{
    var reconnecting = false
    var interval_token
    async function client() {
        let cert = await fs.readFile(variables.cert);

        let options = {
            headers: { "Authorization": variables.token },
            port: 1
        }
        if (cert) {
            options.ca = cert;
        }
        if (/(\d+\.){3}\d+/.test(new URL(variables.url).hostname)) {
            // Overzealous ws lib adds SNI for IP hosts.
            options.servername = "";
        }
        let ws = new WebSocket(variables.url, options);
        ws.on("open", function() {
            ws.send(JSON.stringify({ "id": "expgaming" }));
            if (reconnecting) {
                clearInterval(interval_token)
            }
        });
        ws.on("message", function(msg) {
            ondata(msg)
        });
        ws.on("error", function(error) {
            if(reconnecting){
                console.log("cant reconnect try again in 10 sec")  
            }else{
                console.error(error)
            }
        })
        ws.on("close", function() {
            console.log("Connection lost");
            if(!reconnecting){
                interval_token = setInterval(function(){
                    client()
                },10000)
            }
            reconnecting = true
        });
        server = ws
    }

    if (require.main === module) {
        client().catch(err => {
            console.error(err);
            process.exitCode = 1;
        });
    }
}
async function ondata(msg){
    let data = JSON.parse(msg);
    if(data.type === "start"){
        var args = data.args
        args = args.join(' ')
        const server_object = servers.local_servers[data.sever]
        var rcon2 = await connect_rcon(server_object.Rcon_port,server_object.Rcon_pass)
        setTimeout(async function() {
            await rcon2.send("/start " + args)
            rcon2.end()
        },10000)
        global.airtable_id = data.id
    }else{
        if(data.type === "connected"){console.log("Connected to server."); return}
        console.log("Unkown type " + data.type )
    }
}


global.tell_server = async function(args,server,id){    
    if(servers["local_servers"][server] != undefined){
        args = args.join(' ')
        const server_object = servers.local_servers[server]
        var rcon2 = await connect_rcon(server_object.Rcon_port,server_object.Rcon_pass)
        setTimeout(async function() {
            await rcon2.send("/start " + args)
            rcon2.end()
        },10000)
    }else{
        if(!variables.Is_lobby){console.error("Server start must be on lobby"); return }
        const str_key = servers["remote_servers"][server]
        if(sockets[str_key] === undefined){console.error("cant find server"); return}
        sockets[str_key].send(JSON.stringify({"type":"start", "args":args, "sever":server,"id":id}));
    }
    
}
async function print_who_won(object){
    setTimeout(async function() {
        const server_object2 = servers.lobby
        var rcon2 = await connect_rcon(server_object2.Rcon_port,server_object2.Rcon_pass)
        var rcon2 = await connect_rcon(server_object2.Rcon_port,server_object2.Rcon_pass)
        await rcon2.send("/sc game.print( \"[color=#FFD700]1st: " + object.Gold+" with a score of " + object.Gold_data +".[/color]\")")
        if (object.Silver != undefined) {
                await rcon2.send("/sc game.print( \"[color=#C0C0C0]2nd: " + object.Silver+" with a score of " + object.Silver_data +".[/color]\")")
            if(object.Bronze != undefined){
                await rcon2.send("/c game.print(\"[color=#cd7f32]3rd:" +object.Bronze+" with a score of" + object.Bronze_data +".[/color]\")")
            }
        }
        rcon2.end()
    },1000)
}

global.send_players = async function(server,object){
    const server_object = servers.local_servers[server]
    var rcon = await connect_rcon(server_object.Rcon_port,server_object.Rcon_pass)
    await rcon.send("/stop_games")
    rcon.end()
    if(variables.Is_lobby){
        print_who_won(object)
    }else{
        server.send(JSON.stringify({ "type": "end_game","data": object}));
    }
}



