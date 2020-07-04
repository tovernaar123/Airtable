"use strict";
var result = require('dotenv').config()
var variables = result.parsed

var Airtable = require('airtable');

const airtable = require("./airtable_object.js")
const clone = require('rfdc')()
const directories = []
for (variable in servers["local_servers"]) {
    var dir = resolveToAbsolutePath(servers["local_servers"][variable].dir)
    console.log(`Watching for file changes on ${dir}`);
    directories.push(dir)

}

global.base = new Airtable({apiKey: key}).base(variables.Base_key);
function resolveToAbsolutePath(path) {
    return path.replace(/%([^%]+)%/g, function(_, key) {
        return process.env[key];
    });
}

const fs = require('fs');

let fsWait = false;
for(path of directories ){
fs.watch(path, (event, filename) => {
  if (filename) {
    if (fsWait) return;
    fsWait = setTimeout(() => {
      fsWait = false;
    }, 100);
    var data = readfile(filename,path)
    console.log(data)
    run_data(data)
  }
});;
}

function readfile(filename,path){
    try {
        var data = fs.readFileSync(path + "\\"+filename, 'utf8');   
        return data
    } catch(e) {
        console.error("error when reading file ",e.stack)
        return 'Error:' + e.stack
    }

}


async function run_data(data){
    var object = JSON.parse(data)
    switch(object.type){
        case "Started_game":
            var json = clone(require("./score_template.json"));
            var player_ids = []
            for (player of object.players ){
                player_ids.push( await airtable.get_player_id(player))
            }
            json[0].fields["Players Present"] = player_ids
            json[0].fields["Time Started"] =  new Date().toISOString();
            json[0].fields["Game"][0] =  await airtable.get_game_id(object.name)
            console.log("game starting with ")
            console.log(json)
            const created = await base('Scoring Data').create(json)
            global.airtable_id = created[0].id
            object.arguments.unshift(object.name)
            console.log(object.arguments)
            tell_server(object.arguments,object.server,airtable_id)
        break

        case "end_game":
            var current_timeDate = new Date()
            var json = clone(require("./score_update_template.json"));
            var players
            json[0].id = airtable_id
            await Promise.all([airtable.get_player_id(object.Gold), airtable.get_player_id(object.Silver), airtable.get_player_id(object.Bronze)]).then((values) => {
                players = values
            });
            players = players.filter(function (el) {
                return el != undefined;
            });
            json[0].fields["Gold Player"][0] = players[0]
            json[0].fields["Gold Data"] = object["Gold_data"]
            if (players[2] != undefined) {
                json[0].fields["Silver Player"][0] = players[1]
                json[0].fields["Silver Data"] = object["Silver_data"]
                if (players[3] != undefined) {
                    json[0].fields["Bronze Player"][0] = players[2]
                    json[0].fields["Bronze Data"] = object["Bronze_data"]
                }else{
                    delete json[0].fields["Bronze Player"]
                    delete json[0].fields["Bronze Data"]
                }
            }else{
                delete json[0].fields["Silver Player"]
                delete json[0].fields["Silver Data"]
                delete json[0].fields["Bronze Player"]
                delete json[0].fields["Bronze Data"]
            }
            var begin_time = await airtable.general_look_up("Scoring Data", "Match ID", id, "Time Started");
            begin_time = new Date(begin_time)
            var difernce = (current_timeDate-begin_time)/1000*60
            json[0].fields["Duration"] = difernce
            console.log("game ending with ")
            console.log(json)
            send_players(object.server,object)
            console.log(base('Scoring Data').update(json))

        break
    }
}