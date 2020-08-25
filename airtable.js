"use strict";
const { lua_array } = require('./helpers.js');


let base;

//Get the id for the record of the player by the given name in the Player Data table
let player_cache = new Map();
async function get_player_id(name) {
    if (player_cache.has(name)) {
        return player_cache.get(name);
    }

    let records = await base('Player Data').select({
        filterByFormula: `{Player Name} = '${name}'`,
        maxRecords: 1,
    }).firstPage();

    if (!records.length) {
        return null;
    }

    let id = records[0].id;
    player_cache.set(name, id);
    return id;
};

//Get the id for the record of the game by the given name in the Game Internals table
let game_cache = new Map();
async function get_game_id(name) {
    if (game_cache.has(name)) {
        return game_cache.get(name);
    }

    let records = await base('Game Internals').select({
        filterByFormula: `{Name} = '${name}'`,
        maxRecords: 1,
    }).firstPage();

    if (!records.length) {
        return null;
    }

    let id = records[0].id;
    game_cache.set(name, id);
    return id;
};

//Create match record in Matches table.
exports.started_game = async function(name, players, variant) {
    let fields = {};
    fields["Players Present"] = [];
    fields["Time Started"] = new Date().toISOString();
    if (variant) { fields["Variant"] = variant; }
    let game_id = await get_game_id(name);
    if (game_id !== null) {
        fields["Game"] = [game_id];
    } else {
        console.log(`Warning: Got started_game for nonexistent game ${name}`);
    }
    for (let player of players) {
        let player_id = await get_player_id(player);
        if (player_id) {
            fields["Players Present"].push(player_id);
        }
    }
    console.log(`game starting with this ${JSON.stringify(fields)} as the fields. `);
    const created = await base('Matches').create(fields);
    console.log(created);
    return created.id;
};

//Update match records in Matches and Match Scares tables with pole positions.
exports.stopped_game = async function(results, record_id) {
    let time_ended = new Date().toISOString();
    let records = [];

    for (let entry of results) {
        let fields = {};
        let player_ids = await Promise.all(
            lua_array(entry.players).map(player => get_player_id(player))
        );

        fields["Match"] = [record_id];
        fields["Players"] = player_ids.filter((id) => id !== null);
        if (entry.place) { fields["Place"] = entry.place; }
        if (entry.score) { fields["Score"] = entry.score; }
        if (entry.extra) { fields["Extra"] = JSON.stringify(entry.extra); }
        records.push({ fields });
    }

    if (records.length) {
        //Create scores entries for the match
        console.log(`Game ending with scores ${JSON.stringify(records)}`);
        await base("Match Scores").create(records);
    }

    //Update Match end time
    await base('Matches').update(record_id, { "Time Ended": time_ended });
};

exports.add_player = async function(player_name) {
    let player_id = await get_player_id(player_name);
    if (player_id !== null) { return; };
    const player_record = await base('Player Data').create({
        "Player Name": `${player_name}`,
        "Roles": [
            "Participant",
        ],
        "Auto Signup": true,
    });
    player_cache.set(player_name, player_record.id);
};

let players_roles = Object.create(null);
let last_checked = '';
const events = require('events');
const airtable_events = new events.EventEmitter();
airtable_events.on("newListener", function (event, listener) {
    if (event === "init") {
        if (Object.keys(players_roles).length !== 0) {
            listener(players_roles);
        }
    }
});

async function check_roles() {
    let check = new Date().toISOString();
    await base('Player Data').select({
        fields: ["Roles", "Player Name"],
        filterByFormula: `DATETIME_DIFF( LAST_MODIFIED_TIME(), '${last_checked}', 'milliseconds') >= 0`,
    }).eachPage(function page(records, fetchNextPage) {
        for (let record of records) {
            let player_name = record.get('Player Name');
            if (player_name === undefined) { continue; }
            player_name = player_name.replace(/'/g, "\\'");

            let prev_roles = players_roles[player_name] || [];
            let curr_roles = record.get('Roles') || [];

            let added_roles = curr_roles.filter(r => !prev_roles.includes(r));
            let removed_roles = prev_roles.filter(r => !curr_roles.includes(r));
            players_roles[player_name] = curr_roles;

            if (added_roles.length > 0) {
                airtable_events.emit('added_roles', added_roles, player_name);
                console.log(`added ${added_roles} as roles to ${player_name}`);
            }
            if (removed_roles.length > 0) {
                airtable_events.emit('removed_roles', removed_roles, player_name);
                console.log(`removed ${removed_roles} from ${player_name}`);
            }

        };

        fetchNextPage();
    });
    last_checked = check;
}

exports.airtable_events = airtable_events;
exports.player_roles = players_roles;
exports.set_base = function set_base(new_base) {
    base = new_base;
};

exports.init = async function init() {
    last_checked = new Date().toISOString();
    let pages = await base('Player Data').select({
        fields: ["Roles", "Player Name"],
    });

    await pages.eachPage(
        function page(records, fetchNextPage) {
            for (let record of records) {
                let player_name = record.get('Player Name');
                if (player_name === undefined) { continue; }
                player_name = player_name.replace(/'/g, "\\'");
                let roles = record.get('Roles');
                players_roles[player_name] = roles;
            };
            fetchNextPage();
        });
    airtable_events.emit('init', players_roles);
    setInterval(() => {
        check_roles().catch((err) => {
            console.error(err);
        });
    }, 10000);

    return airtable_events;
};