// Network detection straight from the kernel (procfs/sysfs).
//
// Used when NetworkManager is not running, and as a sanity check when the
// interface NetworkManager reports does not exist in our network namespace.
// GLib's network monitor (netlink based) signals routing changes, which
// triggers an immediate refresh; a slow poll catches what it does not report,
// such as link state changes. The files involved are tiny and in memory.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {EventEmitter} from '../utils/Signals.js';
import {readText, readLink, exists} from '../utils/Files.js';
import * as Logger from '../utils/Logger.js';
import {
    InterfaceType, ConnectionState, TETHERING_DRIVERS, MOBILE_DRIVERS,
    makeNetworkInfo, sameNetworkInfo,
} from './InterfaceTypes.js';

const POLL_INTERVAL_MS = 3000;
// Route changes arrive in bursts; settle before re-reading.
const SETTLE_DELAY_MS = 200;
const RTF_UP = 0x1;
const RTF_REJECT = 0x200;
const ARPHRD_ETHER = 1;
const ARPHRD_NONE = 65534;

/**
 * @param {string} hex - little-endian hex IPv4 address from /proc/net/route
 * @returns {string} dotted quad
 */
export function hexToIPv4(hex) {
    const n = parseInt(hex, 16);
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].join('.');
}

/**
 * @param {string} text - contents of /proc/net/route
 * @returns {{iface: string, destination: number, gateway: string,
 *            mask: number, metric: number, isDefault: boolean}[]}
 */
export function parseIPv4Routes(text) {
    const routes = [];
    for (const line of (text ?? '').split('\n').slice(1)) {
        const f = line.trim().split(/\s+/);
        if (f.length < 8)
            continue;
        const flags = parseInt(f[3], 16);
        if (!(flags & RTF_UP) || (flags & RTF_REJECT))
            continue;
        routes.push({
            iface: f[0],
            destination: parseInt(f[1], 16) >>> 0,
            gateway: hexToIPv4(f[2]),
            mask: parseInt(f[7], 16) >>> 0,
            metric: parseInt(f[6], 10),
            isDefault: f[1] === '00000000' && f[7] === '00000000',
        });
    }
    return routes;
}

/**
 * @param {string} text - contents of /proc/net/ipv6_route
 * @returns {{iface: string, metric: number}[]} default IPv6 routes
 */
export function parseIPv6DefaultRoutes(text) {
    const routes = [];
    for (const line of (text ?? '').split('\n')) {
        const f = line.trim().split(/\s+/);
        if (f.length < 10)
            continue;
        const flags = parseInt(f[8], 16);
        const isDefault = /^0+$/.test(f[0]) && f[1] === '00';
        if (!isDefault || !(flags & RTF_UP) || (flags & RTF_REJECT) || f[9] === 'lo')
            continue;
        routes.push({iface: f[9], metric: parseInt(f[5], 16)});
    }
    return routes;
}

/**
 * Picks the interface carrying the default route with the lowest metric,
 * preferring IPv4 and falling back to IPv6-only networks.
 *
 * @param {string} ipv4Routes - contents of /proc/net/route
 * @param {string} ipv6Routes - contents of /proc/net/ipv6_route
 * @param {(iface: string) => boolean} accept - filter for candidates
 * @returns {string|null} interface name
 */
export function findDefaultInterface(ipv4Routes, ipv6Routes, accept = () => true) {
    const byMetric = (a, b) => a.metric - b.metric;
    const v4 = parseIPv4Routes(ipv4Routes)
        .filter(r => r.isDefault && accept(r.iface)).sort(byMetric);
    if (v4.length > 0)
        return v4[0].iface;
    const v6 = parseIPv6DefaultRoutes(ipv6Routes)
        .filter(r => accept(r.iface)).sort(byMetric);
    return v6[0]?.iface ?? null;
}

/**
 * Finds the IPv4 address of an interface by matching the kernel's local
 * addresses (/proc/net/fib_trie) against the interface's on-link routes.
 *
 * @param {string} iface - interface name
 * @param {string} routeText - contents of /proc/net/route
 * @param {string} fibTrieText - contents of /proc/net/fib_trie
 * @returns {string|null} dotted quad
 */
export function findIPv4Address(iface, routeText, fibTrieText) {
    const toInt = ip => ip.split('.').reduce((acc, o) => ((acc << 8) | Number(o)) >>> 0, 0);
    // /proc/net/route stores addresses little-endian; convert to host order.
    const swap = n => (((n & 0xff) << 24) | ((n & 0xff00) << 8) |
        ((n >>> 8) & 0xff00) | (n >>> 24)) >>> 0;
    const subnets = parseIPv4Routes(routeText)
        .filter(r => r.iface === iface && !r.isDefault && r.gateway === '0.0.0.0')
        .map(r => ({net: swap(r.destination), mask: swap(r.mask)}));

    const locals = new Set();
    const lines = (fibTrieText ?? '').split('\n');
    for (let i = 1; i < lines.length; i++) {
        if (!/\/32 host LOCAL/.test(lines[i]))
            continue;
        const m = lines[i - 1].match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m)
            locals.add(m[1]);
    }

    for (const ip of locals) {
        const n = toInt(ip);
        if (subnets.some(s => ((n & s.mask) >>> 0) === s.net))
            return ip;
    }
    return null;
}

/**
 * @param {string} iface - interface name
 * @param {string} ifInet6Text - contents of /proc/net/if_inet6
 * @returns {string|null} first global-scope IPv6 address
 */
export function findIPv6Address(iface, ifInet6Text) {
    for (const line of (ifInet6Text ?? '').split('\n')) {
        const f = line.trim().split(/\s+/);
        // Scope 00 is global; link-local (20) and loopback (10) are skipped.
        if (f.length < 6 || f[5] !== iface || f[3] !== '00')
            continue;
        return f[0].match(/.{4}/g).map(g => g.replace(/^0{1,3}/, '')).join(':')
            .replace(/(^|:)0(:0)+(:|$)/, '::');
    }
    return null;
}

/**
 * Classifies an interface from its sysfs attributes.
 *
 * @param {string} iface - interface name
 * @param {string} sysRoot - sysfs network class directory
 * @returns {string} one of InterfaceType
 */
export function classifyInterface(iface, sysRoot = '/sys/class/net') {
    const dir = `${sysRoot}/${iface}`;
    const uevent = readText(`${dir}/uevent`) ?? '';
    const devType = uevent.match(/^DEVTYPE=(.*)$/m)?.[1] ?? '';
    const arpType = parseInt(readText(`${dir}/type`) ?? '0', 10);

    if (devType === 'wlan' || exists(`${dir}/wireless`) || exists(`${dir}/phy80211`))
        return InterfaceType.WIFI;
    if (devType === 'wireguard' || exists(`${dir}/tun_flags`))
        return InterfaceType.VPN;
    if (devType === 'wwan' || iface.startsWith('ppp') || iface.startsWith('wwan'))
        return InterfaceType.MOBILE;
    if (iface.startsWith('bnep'))
        return InterfaceType.BLUETOOTH;

    const driverLink = readLink(`${dir}/device/driver`);
    const driver = driverLink ? GLib.path_get_basename(driverLink) : null;
    if (driver && TETHERING_DRIVERS.has(driver))
        return InterfaceType.USB_TETHERING;
    if (driver && MOBILE_DRIVERS.has(driver))
        return InterfaceType.MOBILE;
    if (arpType === ARPHRD_ETHER && exists(`${dir}/device`) && !devType)
        return InterfaceType.ETHERNET;
    if (arpType === ARPHRD_NONE && iface.startsWith('wg'))
        return InterfaceType.VPN;
    return InterfaceType.OTHER;
}

/**
 * @param {string} sysRoot - sysfs network class directory
 * @returns {string[]} names of all non-loopback interfaces
 */
export function listInterfaces(sysRoot = '/sys/class/net') {
    const names = [];
    try {
        const dir = GLib.Dir.open(sysRoot, 0);
        let name;
        while ((name = dir.read_name()) !== null) {
            if (name !== 'lo')
                names.push(name);
        }
        dir.close();
    } catch {
        // No sysfs: nothing to list.
    }
    return names.sort();
}

/**
 * @param {string} iface - interface name
 * @param {string} sysRoot - sysfs network class directory
 * @returns {boolean} whether the interface has readable traffic counters
 */
export function hasStatistics(iface, sysRoot = '/sys/class/net') {
    return exists(`${sysRoot}/${iface}/statistics/rx_bytes`);
}

/**
 * @param {string} iface - interface name
 * @param {string} sysRoot - sysfs network class directory
 * @returns {boolean} whether the link is administratively up with carrier
 */
function isLinkUp(iface, sysRoot) {
    const operstate = (readText(`${sysRoot}/${iface}/operstate`) ?? '').trim();
    // Virtual and tunnel devices often report "unknown" while working fine.
    return operstate === 'up' || operstate === 'unknown';
}

/**
 * Builds a NetworkInfo from kernel state alone.
 *
 * @param {object} [options] - options
 * @param {string} [options.procRoot] - procfs mount point (for tests)
 * @param {string} [options.sysRoot] - sysfs network class directory (for tests)
 * @param {string|null} [options.manualInterface] - describe this interface
 *   instead of the one carrying the default route
 * @returns {import('./InterfaceTypes.js').NetworkInfo}
 */
export function detectKernelNetwork({procRoot = '/proc', sysRoot = '/sys/class/net',
    manualInterface = null} = {}) {
    const routeText = readText(`${procRoot}/net/route`);
    const route6Text = readText(`${procRoot}/net/ipv6_route`);
    const source = manualInterface ? 'manual' : 'kernel';

    const isTunnel = iface => classifyInterface(iface, sysRoot) === InterfaceType.VPN;
    const usable = iface => hasStatistics(iface, sysRoot) && isLinkUp(iface, sysRoot);

    let name;
    if (manualInterface) {
        name = hasStatistics(manualInterface, sysRoot) ? manualInterface : null;
    } else {
        // Prefer a physical uplink; split-tunnel and policy-routed VPNs keep
        // the main-table default route on it.
        name = findDefaultInterface(routeText, route6Text, i => usable(i) && !isTunnel(i));
        name ??= findDefaultInterface(routeText, route6Text, usable);
    }

    const vpnIface = listInterfaces(sysRoot)
        .find(i => i !== name && isTunnel(i) && isLinkUp(i, sysRoot));
    const vpn = vpnIface ? {name: vpnIface, iface: vpnIface} : null;

    if (!name)
        return makeNetworkInfo({source, vpn});

    return makeNetworkInfo({
        name,
        type: classifyInterface(name, sysRoot),
        state: isLinkUp(name, sysRoot) ? ConnectionState.CONNECTED : ConnectionState.DISCONNECTED,
        ipv4: findIPv4Address(name, routeText, readText(`${procRoot}/net/fib_trie`)),
        ipv6: findIPv6Address(name, readText(`${procRoot}/net/if_inet6`)),
        vpn,
        source,
    });
}

export class KernelBackend extends EventEmitter {
    /**
     * @param {object} [options] - see detectKernelNetwork()
     */
    constructor(options = {}) {
        super();
        this._options = {...options};
        this._info = makeNetworkInfo();
        this._timerId = 0;
        this._settleId = 0;
        this._monitor = null;
        this._monitorId = 0;
    }

    /** @returns {import('./InterfaceTypes.js').NetworkInfo} */
    get info() {
        return this._info;
    }

    start() {
        this.refresh();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, POLL_INTERVAL_MS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
        try {
            this._monitor = Gio.NetworkMonitor.get_default();
            this._monitorId = this._monitor.connect('network-changed', () => this._queueRefresh());
        } catch (e) {
            Logger.debug('No network change notifications, polling only:', e.message);
        }
    }

    _queueRefresh() {
        if (this._settleId)
            return;
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_DELAY_MS, () => {
            this._settleId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    refresh() {
        let info;
        try {
            info = detectKernelNetwork(this._options);
        } catch (e) {
            Logger.warn('Kernel network detection failed:', e.message);
            info = makeNetworkInfo();
        }
        if (sameNetworkInfo(info, this._info))
            return;
        this._info = info;
        this.emit('changed', info);
    }

    /** @param {string|null} name - interface to describe, or null for automatic */
    setManualInterface(name) {
        if (this._options.manualInterface === name)
            return;
        this._options.manualInterface = name;
        this.refresh();
    }

    destroy() {
        for (const id of [this._timerId, this._settleId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._timerId = this._settleId = 0;
        // The monitor is a process-wide singleton; only drop our handler.
        if (this._monitorId)
            GObject.signal_handler_disconnect(this._monitor, this._monitorId);
        this._monitor = null;
        this._monitorId = 0;
        this.disconnectAll();
    }
}
