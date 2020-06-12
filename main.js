
var result = require('dotenv').config()
var variables = result.parsed
const key  = variables.Api_key
const host = variables.Host
const rcon_pass= variables.Rcon_pass
const data_path = resolveToAbsolutePath(variables.Path);

Rcon = require("rcon-client").Rcon
async function connect_rcon(){
    const rcon = new Rcon({ host: host, port: 4444, password: rcon_pass })
    await rcon.connect()
    return rcon
}

const fs = require('fs');
const readline = require('readline');
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
    console.log(filename)
    readfile(filename)
    rcon.send("file read")
  }
});;

function readfile(filename){
    try {
        var data = fs.readFileSync(data_path + "\\"+filename, 'utf8');
        console.log(data);    
    } catch(e) {
        console.log('Error:', e.stack);
    }
}

var Airtable = require('airtable');
var base = new Airtable({apiKey: key}).base(variables.Base_key);
var game_internals = base('Game Internals')
base('Scoring Data').select({
    // Selecting the first 3 records in Public Facing Event List:
    maxRecords: 15,
    //view: "Public Facing Event List"
}).eachPage(function page(records, fetchNextPage) {
    // This function (`page`) will get called for each page of records.

    records.forEach(function(record) {
        var id = record.get('Gold Data')
        console.log('Retrieved',id);
    });

    fetchNextPage();

}, function done(err) {
    if (err) { console.error(err); return; }
});