// Unit test entry point: gjs -m tests/run.js [name-filter]

import GLib from 'gi://GLib';
import System from 'system';

import {run} from './harness.js';

import './unit/kernelBackend.test.js';
import './unit/formatters.test.js';
import './unit/speedMonitor.test.js';
import './unit/panelText.test.js';
import './unit/usage.test.js';
import './unit/usageAlerts.test.js';
import './unit/errors.test.js';

const loop = new GLib.MainLoop(null, false);
let ok = false;
run(ARGV[0]).then(result => {
    ok = result;
}).catch(e => {
    print(e.stack);
}).finally(() => loop.quit());
loop.run();
System.exit(ok ? 0 : 1);
