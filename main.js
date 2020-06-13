
var result = require('dotenv').config()
var variables = result.parsed
const key  = variables.Api_key
const host = variables.Host
const rcon_pass= variables.Rcon_pass
const data_path = resolveToAbsolutePath(variables.Path);
const clone = require('rfdc')()
const airtable = require(__dirname + "\\airtable_object.js")
var Airtable = require('airtable');
global.base = new Airtable({apiKey: key}).base(variables.Base_key);
airtable.get_player_id("Drahc_pro")
var game_internals = base('Game Internals')

Rcon = require("rcon-client").Rcon
async function connect_rcon(){
    const rcon = new Rcon({ host: host, port: 4444, password: rcon_pass })
    await rcon.connect()
    return rcon
}

const fs = require('fs');
const readline = require('readline');
const { stringify } = require('querystring')
function resolveToAbsolutePath(path) {
    return path.replace(/%([^%]+)%/g, function(_, key) {
        return process.env[key];
    });
}

console.log(`Watching for file changes on ${data_path}`);

let fsWait = false;
fs.watch(data_path, (event, filename) => {
  if (filename) {
    if (fsWait) return;
    fsWait = setTimeout(() => {
      fsWait = false;
    }, 100);
    var data = readfile(filename)
    run_data(data)
  }
});;

function readfile(filename){
    try {
        var data = fs.readFileSync(data_path + "\\"+filename, 'utf8');   
        return data
    } catch(e) {
        return 'Error:' + e.stack
    }

}
function run_data(data){
    var object = JSON.parse(data)
    console.log(object.type) 
    var json = clone(require(__dirname + "\\score_template.json"));
    json[0].fields["Bronze Data"] = 1
}
