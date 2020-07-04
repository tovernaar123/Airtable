var player_chace = {}
var game_chace = {}
exports.get_player_id = async function(name) {
    if (!player_chace[name]) {
        const result = await get_player_id_promise(name)
        return result
    } else {
        return player_chace[name]
    }
}

function get_player_id_promise(name) {
    const result = new Promise((resolve, reject) => {
        base('Player Data').select({
            filterByFormula: "{Player Name} = '" + name + "'"
        }).eachPage(function page(records, fetchNextPage) {
            records.forEach(function(record) {
                player_chace[name] = record.id
            })
            fetchNextPage();
        }, function done(err) {
            if (err) { console.error(err); return reject(err) }
            return resolve(player_chace[name]);

        })
    });
    return result
}
exports.get_game_id = async function(name) {
    if (!game_chace[name]) {
        const result = await get_game_id_promise(name)
        return result
    } else {
        return game_chace[name]
    }
}

function get_game_id_promise(name) {
    const result = new Promise((resolve, reject) => {
        base('Game Internals').select({
            filterByFormula: "{Name} = '" + name + "'"
        }).eachPage(function page(records, fetchNextPage) {
            records.forEach(function(record) {
                game_chace[name] = record.id
            })
            fetchNextPage();
        }, function done(err) {
            if (err) {
                console.error(err);
                console.log(name);
                return reject(err)
            }
            return resolve(game_chace[name]);

        })
    });
    return result
}
/**
    @param {string} table - table to look in.
    @param {string} colum_for_search - colum you have to value of.
    @param {string} value - the value of colum_for_search.
    @param {string} answer_colum - the colum you want the value of.
    @returns {any}  the value found.
 */
exports.gernal_look_up = async function(table, colum_for_search, value, answer_colum) {
    const result = await gernal_look_up_promise(table, colum_for_search, value, answer_colum)
    return result
}

function gernal_look_up_promise(table, colum_for_search, value, answer_colum) {
    var pre_result
    const result = new Promise((resolve, reject) => {
        base(table).select({
            filterByFormula: "{" + colum_for_search + "} = " + "'" + value + "'"
        }).eachPage(function page(record, fetchNextPage) {
            pre_result = record[0].fields[answer_colum]
            fetchNextPage();
        }, function done(err) {
            if (err) { console.error(err); return reject(err) }
            return resolve(pre_result);

        })
    });
    return result
}