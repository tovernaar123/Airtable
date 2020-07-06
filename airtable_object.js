"use strict";

let player_cache = new Map();
exports.get_player_id = async function(base, name) {
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
}

let game_cache = new Map();
exports.get_game_id = async function(base, name) {
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
}

/**
    @param {string} table - table to look in.
    @param {string} colum_for_search - colum you have to value of.
    @param {string} value - the value of colum_for_search.
    @param {string} answer_colum - the colum you want the value of.
    @returns {any}  the value found.
 */
exports.general_look_up = async function(base, table, colum_for_search, value, answer_colum) {
    let records = base(table).select({
        filterByFormula: `{${colum_for_search}} = '${value}'`,
        maxRecords: 1,
    }).firstPage();

    if (!records.length) {
        return null;
    }

    return records[0].fields[answer_column];
}