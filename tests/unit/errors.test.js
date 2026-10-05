import {test, assert, assertEqual, makeTempDir, writeFile} from '../harness.js';
import {isValidInterfaceName, makeNetworkInfo} from '../../src/network/InterfaceTypes.js';
import {InterfaceMonitor} from '../../src/network/InterfaceMonitor.js';
import {readCounters} from '../../src/network/SpeedMonitor.js';
import {hasStatistics} from '../../src/network/KernelBackend.js';
import {UsageStorage, emptyData} from '../../src/usage/UsageStorage.js';
import * as Logger from '../../src/utils/Logger.js';

test('interface names follow the kernel rules', () => {
    for (const name of ['wlp2s0', 'enp3s0', 'eth0', 'wg0', 'br-1a2b3c4d5e6f', 'veth9.100', 'a'])
        assert(isValidInterfaceName(name), name);
    for (const name of ['', '.', '..', '../../etc', 'a/b', 'eth0:1', 'has space', 'x'.repeat(16), null])
        assert(!isValidInterfaceName(name), String(name));
});

test('sysfs readers refuse invalid names', () => {
    assertEqual(readCounters('../../../proc/self'), null);
    assertEqual(hasStatistics('..'), false);
});

test('guard keeps callers running and reports the value', () => {
    assertEqual(Logger.guard('testing', () => 42), 42);
    assertEqual(Logger.guard('testing', () => {
        throw new Error('boom');
    }, 'fallback'), 'fallback');
});

test('saving to an unwritable location fails softly', () => {
    // A regular file where the data directory should be.
    const storage = new UsageStorage('/proc/version/netpulse/usage.json');
    assertEqual(storage.save(emptyData(), '2026-10-05'), false);
    assertEqual(storage.save(emptyData(), '2026-10-05'), false);
});

test('detection falls back to the kernel while NetworkManager is down', () => {
    const root = makeTempDir();
    const write = (path, text) => writeFile(`${root}/${path}`, text);
    write('sys/eth0/statistics/rx_bytes', '0\n');
    write('sys/eth0/operstate', 'up\n');
    write('proc/net/route', 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n' +
        'eth0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\n');

    const monitor = new InterfaceMonitor({useNetworkManager: false, sysRoot: `${root}/sys`, procRoot: `${root}/proc`});
    const nm = {running: false, info: makeNetworkInfo({name: 'eth0', connection: 'Wired', state: 'connected', source: 'networkmanager'}), destroy() {}};
    monitor._nm = nm;
    monitor._update();
    assertEqual([monitor.info.name, monitor.info.source], ['eth0', 'kernel'], 'NetworkManager stopped');

    nm.running = true;
    monitor._update();
    assertEqual([monitor.info.connection, monitor.info.source], ['Wired', 'networkmanager'], 'NetworkManager back');
    assertEqual(monitor._kernel, null, 'kernel polling stops again');
    monitor.destroy();
});
