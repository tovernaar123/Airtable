"use strict";
const events = require('events');
const rcon_client = require("rcon-client");
const { print_error } = require('./helpers.js');

//Set up RCON connections for all servers.
exports.connect_to_server = function(server) {
    const client = new rcon_client.Rcon({
        host: "localhost",
        port: server.Rcon_port,
        password: server.Rcon_pass,
    });

    //Show commands sent and their reply for debugging
    let real_send = client.send;
    client.send = function(cmd) {
        return real_send.call(client, cmd).then(res => {
            console.log(server.ip, cmd, "=>", res.slice(0, -1));
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
            console.log(`Connected to ${server.ip}`);
            connected = true;
            return server.rcon_event({ type: "connect" }).catch(
                print_error("during rcon event connect")
            );

        //Reconnect if the attempt failed
        }).catch(err => {
            console.log(`Connecting to ${server.ip} failed:`, err.message);
            console.log("Reconnecting in 10 seconds");
            setTimeout(connect, 10e3).unref();
        });
    }

    client.on("end", function() {
        //Reconnect if a successfull connection was made.
        if (connected) {
            console.log(`Lost connection with ${server.ip}`);
            console.log("Reconnecting in 10 seconds");
            connected = false;
            server.rcon_event({ type: "close" }).catch(
                print_error("during rcon event close")
            );
            setTimeout(connect, 10e3).unref();
        }
    });

    client.on("error", function(err) {
        console.log(`Error on rcon for ${server.ip}`, err.message);
    });

    connect();
    return client;
};