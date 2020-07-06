exports.init = async function name(file_listner) {
    file_events.on("Started_game", async function(object) {
        let json = clone(require("./score_template.json"));
        let player_ids = []
        let fiels = json[0].fields
        for (let player of object.players) {
            player_ids.push(await airtable.get_player_id(base, player))
        }
        fiels["Players Present"] = player_ids
        fiels["Time Started"] = new Date().toISOString();
        fiels["Game"][0] = await airtable.get_game_id(base, object.name)
        console.log("game starting with ")
        console.log(json)
        const created = await base('Scoring Data').create(json)
        console.log(created)
        global.airtable_id = created[0].id
    });
    file_events.on("end_game", async function(object) {
        let current_timeDate = new Date()
        let json = clone(require("./score_update_template.json"));
        let players
        json[0].id = airtable_id
        await Promise.all([
            airtable.get_player_id(base, object.Gold),
            airtable.get_player_id(base, object.Silver),
            airtable.get_player_id(base, object.Bronze),
        ]).then((values) => {
            players = values
        });
        players = players.filter(function(el) {
            return el != undefined;
        });
        let fiels = json[0].fields
        fiels["Gold Player"][0] = players[0]
        fiels["Gold Data"] = object["Gold_data"]
        if (players[1] != undefined) {
            fiels["Silver Player"][0] = players[1]
            fiels["Silver Data"] = object["Silver_data"]
            if (players[2] != undefined) {
                fiels["Bronze Player"][0] = players[2]
                fiels["Bronze Data"] = object["Bronze_data"]
            } else {
                delete fiels["Bronze Player"]
                delete fiels["Bronze Data"]
            }
        } else {
            delete fiels["Silver Player"]
            delete fiels["Silver Data"]
            delete fiels["Bronze Player"]
            delete fiels["Bronze Data"]
        }
        let begin_time = await airtable.general_lookup(base, "Scoring Data", "Match ID", airtable_id, "Time Started")
        begin_time = new Date(begin_time)
        let difernce = (current_timeDate - begin_time) / 1000 * 60
        json[0].fields["Duration"] = difernce
        console.log("game ending with ")
        console.log(json)
        console.log(await base('Scoring Data').update(json))
    });
}