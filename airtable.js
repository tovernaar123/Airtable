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
exports.stopped_game = async function(base, object, record_id) {
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