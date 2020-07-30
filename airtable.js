"use strict";
const { lua_array } = require('./helpers.js');


//Get the id for the record of the player by the given name in the Player Data table
let player_cache = new Map();
async function get_player_id(base, name) {
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
async function get_game_id(base, name) {
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

//Create match record in Scoring Data table.
exports.started_game = async function(base, name, players) {
    let fields = {};
    fields["Players Present"] = [];
    fields["Time Started"] = new Date().toISOString();
    let game_id = await get_game_id(base, name);
    if (game_id !== null) {
        fields["Game"] = [game_id];
    } else {
        console.log(`Warning: Got started_game for nonexistent game ${name}`);
    }
    for (let player of players) {
        let player_id = await get_player_id(base, player);
        if (player_id) {
            fields["Players Present"].push(player_id);
        }
    }
    console.log(`game starting with this ${JSON.stringify(fields)} as the fields. `);
    const created = await base('Scoring Data').create(fields);
    console.log(created);
    return created.id;
};

//Update match record in Scoring Data table with pole positions.
exports.stopped_game = async function(base, results, record_id) {
    let fields = {};

    let place_to_field = [null, "Gold", "Silver", "Bronze"];
    for (let entry of results) {
        //Placement above 3rd place is not stored in the airtable.
        if (entry.place > 3) {
            continue;
        }
        let player_ids = await Promise.all(
            lua_array(entry.players).map(player => get_player_id(base, player))
        );
        fields[`${place_to_field[entry.place]} Player`] = player_ids.filter((id) => id !== null);
        fields[`${place_to_field[entry.place]} Data`] = entry.score;
    }

    fields["Time Ended"] = new Date().toISOString();
    console.log(`game ending with this ${JSON.stringify(fields)} as the fields. `);
    console.log(await base('Scoring Data').update(record_id, fields));
};

let players_roles = {};
let last_checked = '';
const events = require('events');
const airtable_events = new events.EventEmitter();
airtable_events.on("newListener", (event, listener) => {
    if (event === "init") {
        if (Object.keys(players_roles).length !== 0) {
            listener(players_roles);
        }
    }
});
exports.airtable_events = airtable_events;
exports.player_roles = players_roles;
exports.init = async function init(base) {

    last_checked = new Date().toISOString();
    let pages = await base('Player Data').select({
        fields: ["roles", "Player Name"],
    });

    await new Promise(function(resolve, reject) {
        pages.eachPage(function page(records, fetchNextPage) {

            records.forEach(function(record) {
                let player_name = record.get('Player Name');
                player_name = player_name.replace(/'/g, "\\'");
                let roles = record.get('roles');
                players_roles[player_name] = roles;
            });

            fetchNextPage();
        }, function done(err) {
            if (err) { console.error(err); reject(err); }
            resolve();
        });
    });
    airtable_events.emit('init', players_roles);
    setInterval(async () => {
        let check = new Date().toISOString();
        await new Promise(function(resolve, reject) {
            pages = base('Player Data').select({
                fields: ["roles", "Player Name"],
                filterByFormula: `DATETIME_DIFF( LAST_MODIFIED_TIME(), '${last_checked}', 'milliseconds') >= 0`,
            }).eachPage(function page(records, fetchNextPage) {
                console.log('checking roles');
                records.forEach(function(record) {
                    let player_name = record.get('Player Name');
                    player_name = player_name.replace(/'/g, "\\'");
                    console.log(player_name);
                    let currenct_roles = players_roles[player_name];

                    let roles = record.get('roles');

                    let added_roles;
                    let removed_roles;
                    if (roles !== undefined) {
                        if (currenct_roles === undefined) {
                            added_roles = roles;
                            removed_roles = [];
                        } else {
                            added_roles = roles.filter(x => !currenct_roles.includes(x));
                            removed_roles = currenct_roles.filter(x => !roles.includes(x));
                        }
                    } else {
                        added_roles = [];
                        if (currenct_roles === undefined) {
                            removed_roles = [];
                        } else {
                            removed_roles = currenct_roles;
                        }
                    }

                    players_roles[player_name] = roles;
                    if (!Array.isArray(added_roles)) { added_roles = [added_roles]; }
                    if (!Array.isArray(removed_roles)) { removed_roles = [removed_roles]; }

                    if (added_roles.length > 0) {
                        airtable_events.emit('added_roles', added_roles, player_name);
                        console.log(`added ${added_roles} as roles to ${player_name}`);
                    }
                    if (removed_roles.length > 0) {
                        airtable_events.emit('removed_roles', removed_roles, player_name);
                        console.log(`removed ${removed_roles} from ${player_name}`);
                    }

                    console.log(added_roles);
                    console.log(removed_roles);
                });

                fetchNextPage();
            }, function done(err) {
                if (err) { console.error(err); reject(err); }
                resolve();
            });
        });
        last_checked = check;
    }, 10000);

    return airtable_events;
};