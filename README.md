[![Build Status](https://travis-ci.org/kandsten/telldus-queue.svg?branch=master)](https://travis-ci.org/kandsten/telldus-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# telldus-queue
Telldus-queue is a wrapper for the [node-telldus](https://github.com/Hexagon/node-telldus) module, providing 
command repetition and debouncing while maintaining the API from [node-telldus](https://github.com/Hexagon/node-telldus). 

## Why do I need this?
433 Mhz communication tend to be one-way; devices contain only a receiver or a transmitter. If you send a 
signal to turn a plug on and the signal gets lost in space, the plug won't turn on. The simple 
way to deal with this is to send the same command multiple times and hope that at least one signal reaches 
the intended target. 

Consequently, if something else is trying to talk to us and is sending the same command multiple times, we
probably want to ignore any repetitions beyond the first one. 

This library will perform those tasks for you transparently. It'll also maintain a queue so that it doesn't 
repeat a command that has since been countermanded: if you turn the switch on, then off again, you don't want 
to repeat the on command since you know the switch is supposed to be in the off state already.

## Installation
    npm install telldus-queue

## Basic usage
    var telldus = require('telldus-queue');
    telldus.turnOn(1, () => { console.log("Done"); });

## API documentation
See [node-telldus](https://github.com/Hexagon/node-telldus) for the API reference.

The following methods are trapped by telldus-queue but should be 100% call compatible with node-telldus. Anything 
not on this list will be passed along transparently. Callbacks are fired after the command has been transmitted the 
first time. 

* turnOn
* turnOff
* dim
* up
* down
* stop
* bell
* execute
* addDeviceEventListener

This really only makes sense for the async versions of the [node-telldus](https://github.com/Hexagon/node-telldus) 
commands. The async commands passed along to node-telldus, but they _do not_ get any of the queueing benefits.

Only the _addDeviceEventListener()_ function is debounced. If you use the _addSensorEventListener()_ or 
_addRawDeviceEventListener()_ functions, you're on your own. (That said, I'm yet to see a compatible sensor repeat
itself within a very short time frame)

## Credits
Inspired by [node-telldus](https://github.com/Hexagon/node-telldus) and 
[node-red-contrib-tellstick](https://github.com/emiloberg/node-red-contrib-tellstick).
