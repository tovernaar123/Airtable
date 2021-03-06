//Helper functions used in multiple places
"use strict";


/**
    Fixup array serialized from lua by converting empty objects passed to this
    function into empty arrays.  This is necessary because it's not possible
    to tell if an empty table should be an empty object or an empty array and
    the JSON serialize in Factorio picks object for this case.
    @param {Array|Object} array - Array to fix
    @returns {Array} fixed array.
*/
exports.lua_array = function lua_array(array) {
    if (array instanceof Array) {
        return array;
    }
    if (array === null || typeof array !== "object") {
        throw new Error(`Expected array or empty object but got ${array === null ? "null" : typeof array}`);
    }
    if (Object.keys(array).length) {
        throw new Error(`Expected array or empty object but got object with properties ${Object.keys(array)}`);
    }
    return [];
};

/**
    Returns an error handler that will print the error along with the stage it
    was thrown from to aid in debugging.
    @param {string} what - What to attribute the error to.
    @returns {function(Error)} function printing the error given to it.
*/
exports.print_error = function print_error(what) {
    return function(err) {
        console.log(`Error ${what}`);
        console.log(err);
    };
};