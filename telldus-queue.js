/* eslint-env node */
"use strict";
const telldus = require("telldus");

// Setup
// -----
// Boilerplate configuration. These values are tested using some Proove and Nexa gear, 
// little else. node-red-contrib-tellstick uses other timings, probably for a reason. 
// Will be happy to update these if there's a decently well documented need, e.g 
// what equipment requires it. 
var config = {
    txMaxRepeat: 3,
    txInterval: 300,
    txMaxResendTTL: 10000,
    rxDuplicatesTimeout: 1000
};
module.exports.config = config;

// txqueue management
var txqueue = [];
var txbusy = false;
var txtimer;

// rxfilter management, much simpler
var rxfilter = {};



// Clone exports from the telldus module proper, then override the ones we need. 
// Not sure if this is the slickest way of going about it, but it works.
// We only override the async versions - doesn't make much sense to support the 
// async ones. 
for (var ex in telldus) {
    module.exports[ex] = telldus[ex];
}
module.exports.turnOn = function() { enqueue(telldus.turnOn, arguments); };
module.exports.turnOff = function() { enqueue(telldus.turnOff, arguments); };
module.exports.dim = function() { enqueue(telldus.dim, arguments); };
module.exports.up = function() { enqueue(telldus.up, arguments); };
module.exports.down = function() { enqueue(telldus.down, arguments); };
module.exports.stop = function() { enqueue(telldus.stop, arguments); };
module.exports.bell = function() { enqueue(telldus.bell, arguments); };
module.exports.execute = function() { enqueue(telldus.execute, arguments); };



// RX side
// -------
// If we get any duplicates commands within the specified time frame, don't pass on any 
// copy beyond the first one. Haven't seen any device that generates any dupes
// (that makes it beyond telldus-core), this is mirroring node-red-contrib-tellstick 
// functionality since it makes sense in general.
module.exports.addDeviceEventListener = function (callback) {
    telldus.addDeviceEventListener(function(deviceid, status) { 
        if (rxfilter[deviceid] === undefined) { rxfilter[deviceid] = []; }
        rxfilter_scrub();
        var now = Date.now();
        
        for (var entry of rxfilter[deviceid]) {
            if (
                entry.status.name === status.name &&
                entry.status.dimlevel === status.dimlevel
            ) {
                entry.timeout = now + config.rxDuplicatesTimeout;
                return;
            }
        }
        
        rxfilter[deviceid].push({
            timeout: now + config.rxDuplicatesTimeout,
            id: deviceid,
            status: status
        });
        callback(deviceid, status);
    });
};

// Scrub anything that lived longer than the TTL.
function rxfilter_scrub() {
    var now = Date.now();
    for (var device in rxfilter) {
        var i = rxfilter[device].length;
        while (i--) {
            var entry = rxfilter[device][i];
            if (entry.timeout <= now) {
                rxfilter[device].splice(rxfilter[device].indexOf(entry),1);
            }
        }
    }
}




// TX side
// -------

// Figure out whether a contradicts b. A different command being sent to the same device 
// counts as a contradiction, likewise will different dim levels in the case of the dim 
// command.
function superceded(a, b) {
    if (a.args[0] !== b.args[0]) { return false; } /* args[0] -> ID */
    if (a.call !== b.call) { return true; }
    if (a.call === telldus.dim && a.args[1] !== b.args[1]) { return true; } /* args[1] -> Dimlevel */
    return false;
}


// Push a new command to the TX queue and evaluate the existing ones in the queue. 
// If the new command contradicts an old one, mark the old one as invalidated. We 
// won't delete it outright, less of a headache to leave that the the dequeue 
// function.
function enqueue() {
    var command = {
        rep: 0,
        repeatExpires: Date.now() + config.txMaxResendTTL,
        call: arguments[0],
        args: Array.from(arguments[1])
    };
    if (typeof command.args[command.args.length - 1] === "function") {
        command.callback = command.args.pop();
    }
    for (var queued of txqueue) {
        if (superceded(queued, command)) { 
            queued.invalidated = true;
        }
    }
    txqueue.push(command);
    // If there's already TX going on, it'll keep firing due to timers. If the queue is
    // silent, we start it again. 
    if (txbusy !== true) { dequeue(); }
}


// Zap any queued commands that have repeated the max number of times already, are 
// expired or marked as invalid since they've been contradicted by a newer command. 
//
// Avoid using array filters as they copy the array. Modify in place to retain sanity.
function txqueue_scrub() {
    const now = Date.now();
    var i = txqueue.length;
    while (i--) {
        var command = txqueue[i];
        if (
            (command.repeatExpires <= now && command.rep > 0) ||
            (command.rep > config.txMaxRepeat) ||
            (command.invalidated === true)
        ) {
            if (command.callback !== undefined) { command.callback(null); }
            txqueue.splice(txqueue.indexOf(command), 1);
        }
    }
}


// We want to identify the commands with the least number of repetitions on the
// queue, then return the first command matching that number of repetitions.
//
// This essentially makes our dequeueing strategy newest first, then try to ensure
// that recent commands gets repeated more aggressively than ones who already had a
// few repetitions sent out. 
function txqueue_get_candidate() {
    var entries = txqueue.map(function(command){ return command.rep; });
    var min = Math.min(...entries);
    for (var command of txqueue) {
        if (command.rep !== min) { continue; }
        return command;
    }
}

function dequeue() {
    // Scrub the queue of lingering entries that shouldn't be there.
    txqueue_scrub();
    txbusy = (txqueue.length > 0);
    if (txbusy === false) { return false; }
    // If there's still something left, figure out what to run.
    var command = txqueue_get_candidate();
    runCommand(command, (err) => {
        // Fire and remove callback, if one is present. 
        if (command.callback !== undefined) {
            command.callback(err);
            delete command.callback;
        }
        // Up the repetition count and push this command to the back of the queue. 
        // The next dequeue pass will delete it if it's expired or have repeated enough times. 
        command.rep += 1;
        txqueue.splice(txqueue.indexOf(command), 1);
        txqueue.push(command);
        // Schedule another dequeue() run. 
        txtimer = setTimeout(function() { dequeue(); }, config.txInterval);
    });
    return(true);
}

function runCommand(command, callback) {
    var callArgs = command.args.slice();
    callArgs.push(callback);
    command.call.apply(telldus, callArgs);
}

// Testing support
// ---------------
function txqueue_clear() {
    txqueue.length = 0;
    txbusy = false;
}
function txqueue_halt() {
    clearTimeout(txtimer);
    txbusy = true;
}

// These exports are used for testing purposes only. 
if (process.env["TESTING"] !== undefined) {
    module.exports.telldus = telldus;
    module.exports.txqueue = txqueue;
    module.exports.txqueue_halt = txqueue_halt;
    module.exports.txqueue_clear = txqueue_clear;
    module.exports.txqueue_scrub = txqueue_scrub;
    module.exports.txqueue_get_candidate = txqueue_get_candidate;
    module.exports.dequeue = dequeue;
    module.exports.rxfilter = rxfilter;
}
