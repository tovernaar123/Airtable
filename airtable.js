"use strict";
const airtable = require("./airtable_object.js");

const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.Api_key }).base(process.env.Base_key);


exports.Started_game = async function(object) {
    let fields = {};
    fields["Players Present"] = [];
    for (let player of object.players) {
        let player_id = await airtable.get_player_id(base, player);
        if (player_id) {
            fields["Players Present"].push(player_id);
        }
    }
    fields["Time Started"] = new Date().toISOString();
    fields["Game"] = [await airtable.get_game_id(base, object.name)];
    console.log(`game starting with ${JSON.stringify(fields)} as fields`);
    const created = await base('Scoring Data').create(fields);
    return created.id;
};

exports.end_game = async function(object, record_id) {
    let fields = {}
    if (object.Gold) {
        let player = await airtable.get_player_id(base, object.Gold);
        fields["Gold Player"] = player ? [player] : [];
        fields["Gold Data"] = object.Gold_data;
    }
    if (object.Silver) {
        let player = await airtable.get_player_id(base, object.Silver);
        fields["Silver Player"] = player ? [player] : [];
        fields["Silver Data"] = object.Silver_data;
    }
    if (object.Bronze) {
        let player = await airtable.get_player_id(base, object.Bronze);
        fields["Bronze Player"] = player ? [player] : [];
        fields["Bronze Data"] = object.Bronze_data;
    }

    fields["Time Ended"] = new Date().toISOString();
    console.log(`game ending with this ${JSON.stringify(fields)} as the fields. `);
    console.log(await base('Scoring Data').update(record_id, fields));
};