"use strict";
const crypto = require('crypto');
const jwt = require("jsonwebtoken");

crypto.randomBytes(256, (err, bytes) => {
    if (err) {
        console.error(err);
        process.exitCode = 1;
        return;
    }

    console.log(`token=${jwt.sign({}, bytes)}`);
    console.log(`secret=${bytes.toString("base64")}`);
});