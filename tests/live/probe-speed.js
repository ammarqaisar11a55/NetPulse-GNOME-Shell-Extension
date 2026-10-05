// Prints live speed samples for the detected (or given) interface.
//
// Usage: gjs -m tests/live/probe-speed.js [seconds] [--iface=NAME] [--interval=MS]

import GLib from 'gi://GLib';

import {InterfaceMonitor} from '../../src/network/InterfaceMonitor.js';
import {isOnline} from '../../src/network/InterfaceTypes.js';
import {SpeedMonitor} from '../../src/network/SpeedMonitor.js';
import {formatSpeed, formatBytes} from '../../src/utils/Formatters.js';

const arg = name => ARGV.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const seconds = Number(ARGV.find(a => /^\d+$/.test(a)) ?? 10);
const fixedIface = arg('iface');

const loop = new GLib.MainLoop(null, false);
const speed = new SpeedMonitor({intervalMs: Number(arg('interval') ?? 1000)});
let rxTotal = 0, txTotal = 0;
speed.connect('sample', s => {
    rxTotal += s.rxDelta;
    txTotal += s.txDelta;
    print(`${s.iface ?? '-'}  ↓ ${formatSpeed(s.download).padStart(11)}  ↑ ${formatSpeed(s.upload).padStart(11)}`);
});

const monitor = new InterfaceMonitor();
if (fixedIface) {
    speed.setInterface(fixedIface);
} else {
    monitor.connect('changed', info => speed.setInterface(isOnline(info) ? info.name : null));
    await monitor.start();
    speed.setInterface(isOnline(monitor.info) ? monitor.info.name : null);
}

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
    print(`total  ↓ ${formatBytes(rxTotal)} (${rxTotal} B)  ↑ ${formatBytes(txTotal)} (${txTotal} B)`);
    try {
        speed.destroy();
        monitor.destroy();
    } finally {
        loop.quit();
    }
    return GLib.SOURCE_REMOVE;
});
loop.run();
