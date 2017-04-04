/* eslint-env node, jasmine */
"use strict";
var assert = require("assert"),
    sinon = require("sinon"),
    sinonTest = require("sinon-test");

sinon.test = sinonTest.configureTest(sinon);
sinon.testCase = sinonTest.configureTestCase(sinon);
    
var tq = require("../telldus-queue");

function normalizeQueue(q) {
    for (var entry of q) {
        entry.call = entry.call.displayName;
    }
}

describe("telldus-queue", () => {
    describe("config", () => {
        it("default config should match test defaults", () => {
            var config = {
                txMaxRepeat: 3,
                txInterval: 300,
                txMaxResendTTL: 10000,
                rxDuplicatesTimeout: 1000
            };
            assert.deepEqual(tq.config, config);
        });
    });
    describe("transmit", () => {
        var turnOn, turnOff, dim;
        beforeEach(function() {
            turnOn = sinon.stub(tq.telldus, "turnOn").yields();
            turnOff = sinon.stub(tq.telldus, "turnOff").yields();
            dim = sinon.stub(tq.telldus, "dim").yields();
            tq.txqueue_clear();
            tq.txqueue_halt();
            tq.dequeue();            
        });
        afterEach(function() {
            turnOn.restore();
            turnOff.restore();
            dim.restore();
        });
        it("turns on, repeats thrice, txqueue empty", sinon.test(function() {
            tq.turnOn(1);
            this.clock.tick(tq.config.txInterval);
            assert.equal(turnOn.callCount, 2);
            this.clock.tick(tq.config.txInterval * 2);
            assert.equal(turnOn.callCount, 4);
            tq.dequeue();
            assert.deepEqual(tq.txqueue, []);
        }));
        it("calls back only once on first tx event", sinon.test(function() {
            var ding = 0; 
            tq.turnOn(1, () => { ding += 1; });
            assert.equal(ding, 1);
            this.clock.tick(tq.config.txInterval * 4);
            assert.equal(turnOn.callCount, 4);
            assert.equal(ding, 1);
        }));
        it("command invalidation is set when subsequent commands are countering", sinon.test(function() {
            tq.txqueue_halt();
            tq.turnOn(1);
            tq.turnOff(1);
            normalizeQueue(tq.txqueue);
            assert.deepEqual(tq.txqueue, 
                [ 
                    { rep: 0,
                        repeatExpires: tq.config.txMaxResendTTL,
                        call: "turnOn",
                        args: [1],
                        invalidated: true
                    },
                    { 
                        rep: 0, 
                        repeatExpires: tq.config.txMaxResendTTL, 
                        call: "turnOff", 
                        args: [1] 
                    } 
                ]);
        }));
        it("invalidates longer queues properly", sinon.test(function() {
            tq.txqueue_halt();
            tq.turnOn(1);
            tq.turnOn(1);
            tq.turnOn(1);
            tq.turnOn(1);
            tq.turnOff(1);
            tq.dequeue();
            normalizeQueue(tq.txqueue);
            assert.deepEqual(tq.txqueue, [ { rep: 1, repeatExpires: 10000, call: "turnOff", args: [ 1 ] } ]);
        }));
        it("counts different dimlevels as countering", sinon.test(function() {
            tq.txqueue_halt();
            tq.dim(1, 100);
            tq.dim(1, 200);
            normalizeQueue(tq.txqueue);
            assert.deepEqual(tq.txqueue, 
                [ 
                    { rep: 0,
                        repeatExpires: tq.config.txMaxResendTTL,
                        call: "dim",
                        args: [1, 100],
                        invalidated: true
                    },
                    { 
                        rep: 0, 
                        repeatExpires: tq.config.txMaxResendTTL, 
                        call: "dim", 
                        args: [1, 200] 
                    } 
                ]);
        }));
        it("invalidated commands still fire callbacks", sinon.test(function(done) {
            tq.txqueue_halt();
            tq.turnOn(1, function() { assert(turnOn.notCalled); done(); } );
            tq.turnOff(1);
            tq.dequeue();
        }));
        it("handles queue priority properly", sinon.test(function() {
            this.clock.tick(tq.config.txInterval);
            this.clock.tick(tq.config.txInterval);
            tq.turnOn(2);
            this.clock.tick(tq.config.txInterval);
            tq.turnOn(3);
            assert.deepEqual(tq.txqueue_get_candidate().args, [3]);
        }));
        it("doesn't invalidate subsequent identical commands", sinon.test(function() {
            tq.txqueue_halt();
            tq.turnOn(1);
            tq.turnOn(1);
            tq.turnOn(1);
            normalizeQueue(tq.txqueue);
            assert.deepEqual(tq.txqueue, 
                [ { rep: 0, repeatExpires: 10000, call: "turnOn", args: [ 1 ] },
                  { rep: 0, repeatExpires: 10000, call: "turnOn", args: [ 1 ] },
                  { rep: 0, repeatExpires: 10000, call: "turnOn", args: [ 1 ] } ]
            );
        }));
        it("times out command repetition", sinon.test(function() {
            tq.turnOn(1);
            tq.txqueue_halt();
            this.clock.tick(tq.config.txMaxResendTTL);
            tq.dequeue();
            this.clock.tick(tq.config.txInterval);
            assert.equal(turnOn.callCount, 1);            
        }));
        it("does not time out the initial command", sinon.test(function() {
            tq.txqueue_halt();
            tq.turnOn(1);
            this.clock.tick(tq.config.txMaxResendTTL);
            tq.dequeue();
            this.clock.tick(tq.config.txInterval);
            assert.equal(turnOn.callCount, 1);            
        }));
        it("can call all function (stubs) properly", sinon.test(function() {
            var functions = ["up", "down", "stop", "bell", "execute"];
            for (var fn of functions) {
                var fut = sinon.stub(tq.telldus, fn).yields();
                tq[fn].call(tq, 1);
                this.clock.tick(tq.config.txMaxResendTTL);
                assert.equal(fut.callCount, 4, "call to " + fn + " failed");
                fut.restore();
            }
        }));
    });
    describe("receive", () => {
        var eventSender;
        tq.telldus.addDeviceEventListener = function(fn) {
            eventSender = fn;
        };
        var listener = sinon.spy();
        tq.addDeviceEventListener(listener);
        beforeEach(function() {
            listener.reset();
            for (var entry in tq.rxfilter) {
                tq.rxfilter[entry] = [];
            }
        });
        it("should fire", function() {
            eventSender(1, {"name": "ON"});            
            assert(listener.calledOnce);
        });
        it("should fire once, despite a dupe", function() {
            eventSender(1, {"name": "ON"});
            eventSender(1, {"name": "ON"});
            assert(listener.calledOnce);
        });
        it("should fire once per identical command after timeout", sinon.test(function() {
            eventSender(1, {"name": "ON"});
            this.clock.tick(tq.config.rxDuplicatesTimeout);
            eventSender(1, {"name": "ON"});
            assert(listener.calledTwice);
        }));
        it("should fire once per command, despite a dupe and out of order", function() {
            eventSender(1, {"name": "ON"});
            eventSender(1, {"name": "OFF"});
            eventSender(1, {"name": "ON"});
            assert(listener.calledTwice);
        });
    });
});
