"use strict";
const events = require('events');
const rcon_client = require("rcon-client");

//Set up RCON connections for all servers.
exports.connect_to_servers = function(servers) {
    const rcon_events = new events.EventEmitter();
    for (let [ip, server] of servers) {
        const client = new rcon_client.Rcon({
            host: "localhost",
            port: server.Rcon_port,
            password: server.Rcon_pass,
        });

        //Show commands sent and their reply for debugging
        let real_send = client.send;
        client.send = function(cmd) {
            return real_send.call(client, cmd).then(res => {
                console.log(ip, cmd, "=>", res.slice(0, -1));
                return res;
            });
        };

        let connected;
        function connect() {
            //Workaround for bug in rcon-client
            if (client.socket && !client.socket.writeable && !client.authenticated) {
                client.socket = null;
            }

            //Atempt to connect to the Factorio server
            client.connect().then(() => {
                console.log(`Connected to ${ip}`);
                connected = true;
                rcon_events.emit("connect", ip, server);

            //Reconnect if the attempt failed
            }).catch(err => {
                console.log(`Connecting to ${ip} failed:`, err.message);
                console.log("Reconnecting in 10 seconds");
                setTimeout(connect, 10e3).unref();
            });
        }

        client.on("end", function() {
            //Reconnect if a successfull connection was made.
            if (connected) {
                console.log(`Lost connection with ${ip}`);
                console.log("Reconnecting in 10 seconds");
                connected = false;
                rcon_events.emit("close", ip, server);
                setTimeout(connect, 10e3).unref();
            }
        });

        client.on("error", function(err) {
            console.log(`Error on rcon for ${ip}`, err.message);
        });

        connect();
        server.rcon = client;
    }

    return rcon_events;
};