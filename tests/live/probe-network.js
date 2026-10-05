// Prints what NetPulse detects on this machine, then keeps watching and
// prints every change, so network switches can be tested by hand.
//
// Usage: gjs -m tests/live/probe-network.js [seconds] [--kernel]

import GLib from 'gi://GLib';

import {InterfaceMonitor} from '../../src/network/InterfaceMonitor.js';
import * as Logger from '../../src/utils/Logger.js';

const seconds = Number(ARGV.find(a => /^\d+$/.test(a)) ?? 0);
const useNetworkManager = !ARGV.includes('--kernel');
Logger.setDebug(ARGV.includes('--debug'));

const loop = new GLib.MainLoop(null, false);
const monitor = new InterfaceMonitor({useNetworkManager});
monitor.connect('changed', info => print(`changed: ${JSON.stringify(info)}`));

await monitor.start();
print(`initial: ${JSON.stringify(monitor.info)}`);

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
    try {
        monitor.destroy();
    } finally {
        loop.quit();
    }
    return GLib.SOURCE_REMOVE;
});
loop.run();
