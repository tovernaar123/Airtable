var player_chace = {}
exports.get_player_id = async function(name) {
    if(!player_chace[name]) {
        const result = await get_player_id_promise(name)
        console.log(result)
        return result
    }
}
function get_player_id_promise(name){
    const result = new Promise( (resolve,reject) => {
        base('Player Data').select({
            filterByFormula:"{Player Name} = '"+name+"'"
        }).eachPage(function page(records, fetchNextPage) {
            records.forEach(function(record){
                console.log("found")
                player_chace[name] = record.id
            })
            fetchNextPage();
        },function done(err) {
            if (err) { console.error(err); return reject(err)}
            return resolve(player_chace[name]) ;

        })
    });
    return result
}



