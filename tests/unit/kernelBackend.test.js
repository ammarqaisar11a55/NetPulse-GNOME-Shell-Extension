import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {test, assertEqual, makeTempDir, writeFile} from '../harness.js';
import {
    hexToIPv4, parseIPv4Routes, parseIPv6DefaultRoutes, findDefaultInterface,
    findIPv4Address, findIPv6Address, classifyInterface, listInterfaces,
    detectKernelNetwork,
} from '../../src/network/KernelBackend.js';

// Fixtures derived from a real Ubuntu 26.04 machine, extended with Ethernet.
const ROUTE = `Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask		MTU	Window	IRTT
wlp2s0	00000000	0164A8C0	0003	0	0	600	00000000	0	0	0
wlp2s0	0064A8C0	00000000	0001	0	0	600	00FFFFFF	0	0	0
enp3s0	00000000	010010AC	0003	0	0	100	00000000	0	0	0
enp3s0	000010AC	00000000	0001	0	0	100	0000FFFF	0	0	0
`;

const ROUTE_WIFI_ONLY = ROUTE.split('\n').filter(l => !l.startsWith('enp3s0')).join('\n');

const IPV6_ROUTE = `fe800000000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000400 00000001 00000000 00000001   wlp2s0
00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00005078 0000000d 00000000 00000003   wlp2s0
00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200       lo
`;

const IF_INET6 = `fe80000000000000ba8d93f7b2bef3bb 02 40 20 80   wlp2s0
20010db8000000000000000000000042 02 40 00 00   wlp2s0
00000000000000000000000000000001 01 80 10 80       lo
`;

const FIB_TRIE = `Main:
  +-- 0.0.0.0/0 3 0 5
     +-- 127.0.0.0/8 2 0 2
           |-- 127.0.0.1
              /32 host LOCAL
     +-- 172.16.0.0/16 2 1 2
           |-- 172.16.4.20
              /32 host LOCAL
     +-- 192.168.100.0/24 2 1 2
        +-- 192.168.100.0/26 2 0 2
           |-- 192.168.100.0
              /24 link UNICAST
           |-- 192.168.100.35
              /32 host LOCAL
        |-- 192.168.100.255
           /32 link BROADCAST
`;

/**
 * Builds a fake /sys/class/net and /proc tree.
 *
 * @param {object} [opts] - options
 * @param {string} [opts.route] - /proc/net/route contents
 * @param {string} [opts.ethOperstate] - operstate of enp3s0
 * @returns {{sysRoot: string, procRoot: string}}
 */
function makeFakeSystem({route = ROUTE, ethOperstate = 'up'} = {}) {
    const root = makeTempDir();
    const sys = `${root}/sys`;
    const proc = `${root}/proc`;

    const iface = (name, {uevent = '', type = 1, operstate = 'up', extra = []} = {}) => {
        writeFile(`${sys}/${name}/uevent`, `INTERFACE=${name}\n${uevent}`);
        writeFile(`${sys}/${name}/type`, `${type}\n`);
        writeFile(`${sys}/${name}/operstate`, `${operstate}\n`);
        writeFile(`${sys}/${name}/statistics/rx_bytes`, '1000\n');
        writeFile(`${sys}/${name}/statistics/tx_bytes`, '500\n');
        for (const path of extra)
            GLib.mkdir_with_parents(`${sys}/${name}/${path}`, 0o755);
    };

    iface('wlp2s0', {uevent: 'DEVTYPE=wlan', extra: ['wireless', 'device']});
    iface('enp3s0', {operstate: ethOperstate, extra: ['device']});
    iface('tun0', {type: 65534, operstate: 'unknown'});
    writeFile(`${sys}/tun0/tun_flags`, '0x1001\n');
    iface('wg0', {uevent: 'DEVTYPE=wireguard', type: 65534, operstate: 'down'});
    iface('usb0', {extra: ['device']});
    GLib.mkdir_with_parents(`${root}/drivers/rndis_host`, 0o755);
    Gio.File.new_for_path(`${sys}/usb0/device/driver`)
        .make_symbolic_link(`${root}/drivers/rndis_host`, null);
    iface('veth9', {});
    iface('lo', {type: 772, operstate: 'unknown'});

    writeFile(`${proc}/net/route`, route);
    writeFile(`${proc}/net/ipv6_route`, IPV6_ROUTE);
    writeFile(`${proc}/net/if_inet6`, IF_INET6);
    writeFile(`${proc}/net/fib_trie`, FIB_TRIE);
    return {sysRoot: sys, procRoot: proc};
}

test('hexToIPv4 decodes little-endian addresses', () => {
    assertEqual(hexToIPv4('0164A8C0'), '192.168.100.1');
    assertEqual(hexToIPv4('00000000'), '0.0.0.0');
});

test('parseIPv4Routes finds default routes', () => {
    const routes = parseIPv4Routes(ROUTE);
    assertEqual(routes.length, 4);
    assertEqual(routes.filter(r => r.isDefault).map(r => r.iface), ['wlp2s0', 'enp3s0']);
    assertEqual(routes[0].gateway, '192.168.100.1');
});

test('parseIPv4Routes tolerates empty and malformed input', () => {
    assertEqual(parseIPv4Routes(''), []);
    assertEqual(parseIPv4Routes(null), []);
    assertEqual(parseIPv4Routes('header\ngarbage line\n'), []);
});

test('parseIPv6DefaultRoutes ignores the unreachable loopback route', () => {
    assertEqual(parseIPv6DefaultRoutes(IPV6_ROUTE), [{iface: 'wlp2s0', metric: 0x5078}]);
});

test('findDefaultInterface picks the lowest metric', () => {
    assertEqual(findDefaultInterface(ROUTE, IPV6_ROUTE), 'enp3s0');
    assertEqual(findDefaultInterface(ROUTE, IPV6_ROUTE, i => i !== 'enp3s0'), 'wlp2s0');
});

test('findDefaultInterface falls back to IPv6-only networks', () => {
    assertEqual(findDefaultInterface('header\n', IPV6_ROUTE), 'wlp2s0');
    assertEqual(findDefaultInterface('', ''), null);
});

test('findIPv4Address matches local addresses to on-link subnets', () => {
    assertEqual(findIPv4Address('wlp2s0', ROUTE, FIB_TRIE), '192.168.100.35');
    assertEqual(findIPv4Address('enp3s0', ROUTE, FIB_TRIE), '172.16.4.20');
    assertEqual(findIPv4Address('tun0', ROUTE, FIB_TRIE), null);
});

test('findIPv6Address returns compressed global addresses only', () => {
    assertEqual(findIPv6Address('wlp2s0', IF_INET6), '2001:db8::42');
    assertEqual(findIPv6Address('lo', IF_INET6), null);
});

test('classifyInterface recognizes interface kinds from sysfs', () => {
    const {sysRoot} = makeFakeSystem();
    assertEqual(classifyInterface('wlp2s0', sysRoot), 'wifi');
    assertEqual(classifyInterface('enp3s0', sysRoot), 'ethernet');
    assertEqual(classifyInterface('tun0', sysRoot), 'vpn');
    assertEqual(classifyInterface('wg0', sysRoot), 'vpn');
    assertEqual(classifyInterface('usb0', sysRoot), 'usb-tethering');
    assertEqual(classifyInterface('veth9', sysRoot), 'other');
    assertEqual(classifyInterface('ppp0', sysRoot), 'mobile');
});

test('listInterfaces excludes loopback', () => {
    const {sysRoot} = makeFakeSystem();
    assertEqual(listInterfaces(sysRoot), ['enp3s0', 'tun0', 'usb0', 'veth9', 'wg0', 'wlp2s0']);
    assertEqual(listInterfaces('/nonexistent'), []);
});

test('detectKernelNetwork prefers wired over Wi-Fi by metric', () => {
    const info = detectKernelNetwork(makeFakeSystem());
    assertEqual(info.name, 'enp3s0');
    assertEqual(info.type, 'ethernet');
    assertEqual(info.state, 'connected');
    assertEqual(info.ipv4, '172.16.4.20');
    // tun0 is up and not the uplink, so it is reported as the VPN.
    assertEqual(info.vpn, {name: 'tun0', iface: 'tun0'});
});

test('detectKernelNetwork skips interfaces whose link is down', () => {
    const info = detectKernelNetwork(makeFakeSystem({ethOperstate: 'down'}));
    assertEqual(info.name, 'wlp2s0');
    assertEqual(info.type, 'wifi');
    assertEqual(info.ipv6, '2001:db8::42');
});

test('detectKernelNetwork reports disconnected without default routes', () => {
    const roots = makeFakeSystem({route: 'header\n'});
    writeFile(`${roots.procRoot}/net/ipv6_route`, '');
    const info = detectKernelNetwork(roots);
    assertEqual(info.name, null);
    assertEqual(info.state, 'disconnected');
});

test('detectKernelNetwork survives a missing procfs', () => {
    const info = detectKernelNetwork({procRoot: '/nonexistent', sysRoot: '/nonexistent'});
    assertEqual(info.name, null);
});

test('detectKernelNetwork uses Wi-Fi when it is the only route', () => {
    const info = detectKernelNetwork(makeFakeSystem({route: ROUTE_WIFI_ONLY}));
    assertEqual(info.name, 'wlp2s0');
});

test('detectKernelNetwork describes a manually chosen interface', () => {
    const roots = makeFakeSystem({ethOperstate: 'down'});
    const wifi = detectKernelNetwork({...roots, manualInterface: 'wlp2s0'});
    assertEqual([wifi.name, wifi.type, wifi.state, wifi.source], ['wlp2s0', 'wifi', 'connected', 'manual']);

    const unplugged = detectKernelNetwork({...roots, manualInterface: 'enp3s0'});
    assertEqual([unplugged.name, unplugged.state], ['enp3s0', 'disconnected'], 'link is down');

    const missing = detectKernelNetwork({...roots, manualInterface: 'eth9'});
    assertEqual([missing.name, missing.state, missing.source], [null, 'disconnected', 'manual']);
});
