"use strict";


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
exports.started_game = async function(base, object) {
    let fields = {};
    fields["Players Present"] = [];
    fields["Time Started"] = new Date().toISOString();
    fields["Game"] = [await get_game_id(base, object.name)];
    for (let player of object.players) {
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
exports.end_game = async function(base, object, record_id) {
    let fields = {};
    if (object.Gold) {
        let player = await get_player_id(base, object.Gold);
        fields["Gold Player"] = player ? [player] : [];
        fields["Gold Data"] = object.Gold_data;
    }
    if (object.Silver) {
        let player = await get_player_id(base, object.Silver);
        fields["Silver Player"] = player ? [player] : [];
        fields["Silver Data"] = object.Silver_data;
    }
    if (object.Bronze) {
        let player = await get_player_id(base, object.Bronze);
        fields["Bronze Player"] = player ? [player] : [];
        fields["Bronze Data"] = object.Bronze_data;
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
                console.log('here');
                records.forEach(function(record) {
                    let player_name = record.get('Player Name');
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
                    console.log(`added ${added_roles} as roles to ${player_name}`);
                    console.log(`removed ${removed_roles} these roles from ${player_name}`);
                    if (!Array.isArray(added_roles)) { added_roles = [added_roles]; }
                    if (!Array.isArray(removed_roles)) { removed_roles = [removed_roles]; }

                    if (added_roles.length > 0) { airtable_events.emit('added_roles', added_roles, player_name); }
                    if (removed_roles.length > 0) { airtable_events.emit('removed_roles', removed_roles, player_name); }

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