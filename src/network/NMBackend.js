// Network detection through NetworkManager's client library.
//
// NetworkManager knows which connection carries the default route, the
// connection's name/SSID and whether the internet is actually reachable,
// and it notifies us on every change, so no polling is needed.

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import NM from 'gi://NM';

import {EventEmitter} from '../utils/Signals.js';
import * as Logger from '../utils/Logger.js';
import {
    InterfaceType, ConnectionState, TETHERING_DRIVERS, MOBILE_DRIVERS,
    makeNetworkInfo, sameNetworkInfo,
} from './InterfaceTypes.js';

// Network changes arrive as bursts of property notifications; settle first.
const SETTLE_DELAY_MS = 250;

// Only these properties affect what we report. Others, such as the Wi-Fi
// bitrate or scan timestamps, change constantly and are ignored.
const CLIENT_PROPERTIES = new Set([
    'primary-connection', 'active-connections', 'connectivity', 'state', 'nm-running',
]);
const WATCHED_PROPERTIES = new Set([
    'state', 'ip4-config', 'ip6-config', 'devices', 'id', 'ip-interface',
    'active-access-point', 'addresses',
]);

const VPN_CONNECTION_TYPES = new Set(['vpn', 'wireguard', 'tun']);
const VPN_DEVICE_TYPES = new Set([
    NM.DeviceType.TUN, NM.DeviceType.WIREGUARD, NM.DeviceType.IP_TUNNEL,
]);
const IGNORED_DEVICE_TYPES = new Set([NM.DeviceType.LOOPBACK]);

// Used to pick an uplink when no connection owns the default route.
const TYPE_PRIORITY = [
    InterfaceType.ETHERNET, InterfaceType.USB_TETHERING, InterfaceType.WIFI,
    InterfaceType.MOBILE, InterfaceType.BLUETOOTH, InterfaceType.OTHER,
];

// NM.Device has its own disconnect() method that takes the device offline,
// shadowing GObject's signal disconnect(). Always use these helpers.
const connectSignal = (obj, name, callback) =>
    GObject.Object.prototype.connect.call(obj, name, callback);

/**
 * @param {NM.Device} device - NetworkManager device
 * @returns {string} one of InterfaceType
 */
export function classifyDevice(device) {
    const type = device.get_device_type();
    const driver = device.get_driver?.() ?? '';
    if (VPN_DEVICE_TYPES.has(type))
        return InterfaceType.VPN;
    switch (type) {
    case NM.DeviceType.WIFI:
        return InterfaceType.WIFI;
    case NM.DeviceType.MODEM:
        return InterfaceType.MOBILE;
    case NM.DeviceType.BT:
        return InterfaceType.BLUETOOTH;
    case NM.DeviceType.ETHERNET:
        if (TETHERING_DRIVERS.has(driver))
            return InterfaceType.USB_TETHERING;
        if (MOBILE_DRIVERS.has(driver))
            return InterfaceType.MOBILE;
        return InterfaceType.ETHERNET;
    default:
        return InterfaceType.OTHER;
    }
}

/**
 * @param {NM.ActiveConnection} ac - active connection
 * @returns {boolean} whether the connection is a VPN or tunnel
 */
function isVpnConnection(ac) {
    if (ac.get_vpn() || VPN_CONNECTION_TYPES.has(ac.get_connection_type()))
        return true;
    const device = ac.get_devices()[0];
    return device ? VPN_DEVICE_TYPES.has(device.get_device_type()) : false;
}

/**
 * @param {NM.Device} device - device
 * @returns {string} interface used for IP traffic (e.g. ppp0 for modems)
 */
function trafficInterface(device) {
    return device.get_ip_iface() || device.get_iface();
}

/**
 * @param {NM.Device} device - device
 * @param {NM.ActiveConnection} ac - its active connection
 * @returns {string|null} SSID for Wi-Fi, otherwise the connection name
 */
function connectionName(device, ac) {
    if (device instanceof NM.DeviceWifi) {
        const ssid = device.get_active_access_point()?.get_ssid();
        if (ssid)
            return NM.utils_ssid_to_utf8(ssid.get_data());
    }
    return ac.get_id();
}

/**
 * @param {NM.IPConfig|null} config - IP configuration
 * @param {(address: string) => boolean} [accept] - address filter
 * @returns {string|null} first accepted address
 */
function firstAddress(config, accept = () => true) {
    for (const address of config?.get_addresses() ?? []) {
        const ip = address.get_address();
        if (accept(ip))
            return ip;
    }
    return null;
}

/**
 * Chooses the uplink connection from NetworkManager's active connections.
 *
 * @param {NM.Client} client - connected client
 * @returns {{uplink: NM.ActiveConnection|null, vpn: NM.ActiveConnection|null}}
 */
export function chooseConnections(client) {
    const active = client.get_active_connections().filter(ac =>
        ac.get_state() === NM.ActiveConnectionState.ACTIVATED &&
        ac.get_devices().some(d => !IGNORED_DEVICE_TYPES.has(d.get_device_type())));

    const primary = client.get_primary_connection();
    const vpn = active.find(isVpnConnection) ?? null;

    if (primary && !isVpnConnection(primary))
        return {uplink: primary, vpn};

    // A plugin VPN reports the device it runs over as its own device.
    const base = primary?.get_devices()[0];
    if (base && !VPN_DEVICE_TYPES.has(base.get_device_type())) {
        const baseAc = base.get_active_connection();
        if (baseAc)
            return {uplink: baseAc, vpn: primary};
    }

    const rank = ac => [
        ac.get_default() || ac.get_default6() ? 0 : 1,
        TYPE_PRIORITY.indexOf(classifyDevice(ac.get_devices()[0])),
    ];
    const candidates = active.filter(ac => !isVpnConnection(ac)).sort((a, b) => {
        const [ra, rb] = [rank(a), rank(b)];
        return ra[0] - rb[0] || ra[1] - rb[1];
    });
    return {uplink: candidates[0] ?? null, vpn};
}

/**
 * @param {NM.Client} client - connected client
 * @returns {import('./InterfaceTypes.js').NetworkInfo}
 */
export function describeNetwork(client) {
    const {uplink, vpn} = chooseConnections(client);
    const vpnDevice = vpn?.get_devices()[0];
    const vpnInfo = vpn ? {
        name: vpn.get_id(),
        iface: vpnDevice && VPN_DEVICE_TYPES.has(vpnDevice.get_device_type())
            ? trafficInterface(vpnDevice) : null,
    } : null;

    if (!uplink) {
        const connecting = client.get_state() === NM.State.CONNECTING;
        return makeNetworkInfo({
            source: 'networkmanager',
            state: connecting ? ConnectionState.CONNECTING : ConnectionState.DISCONNECTED,
            vpn: vpnInfo,
        });
    }

    const device = uplink.get_devices()[0];
    const connectivity = client.get_connectivity();
    const limited = connectivity === NM.ConnectivityState.LIMITED ||
        connectivity === NM.ConnectivityState.PORTAL ||
        connectivity === NM.ConnectivityState.NONE;

    return makeNetworkInfo({
        name: trafficInterface(device),
        type: classifyDevice(device),
        connection: connectionName(device, uplink),
        state: limited ? ConnectionState.LIMITED : ConnectionState.CONNECTED,
        ipv4: firstAddress(uplink.get_ip4_config()),
        ipv6: firstAddress(uplink.get_ip6_config(), ip => !ip.toLowerCase().startsWith('fe80')),
        vpn: vpnInfo,
        source: 'networkmanager',
    });
}

export class NMBackend extends EventEmitter {
    /**
     * @param {NM.Client} client - an initialized NetworkManager client
     */
    constructor(client) {
        super();
        this._client = client;
        this._info = makeNetworkInfo({source: 'networkmanager'});
        this._settleId = 0;
        this._watched = [];
    }

    /**
     * @returns {Promise<NMBackend|null>} a backend, or null when
     *   NetworkManager is unavailable
     */
    static async create() {
        try {
            const client = await new Promise((resolve, reject) => {
                NM.Client.new_async(null, (_source, result) => {
                    try {
                        resolve(NM.Client.new_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            return new NMBackend(client);
        } catch (e) {
            Logger.info('NetworkManager unavailable, using kernel detection:', e.message);
            return null;
        }
    }

    /** @returns {boolean} whether the NetworkManager daemon is running */
    get running() {
        return this._client?.get_nm_running() ?? false;
    }

    /** @returns {import('./InterfaceTypes.js').NetworkInfo} */
    get info() {
        return this._info;
    }

    start() {
        const queue = () => this._queueRefresh();
        this._clientHandlers = [
            connectSignal(this._client, 'notify', (_obj, pspec) => {
                if (!CLIENT_PROPERTIES.has(pspec.name))
                    return;
                if (pspec.name === 'nm-running')
                    this.emit('running-changed', this.running);
                queue();
            }),
            connectSignal(this._client, 'active-connection-added', queue),
            connectSignal(this._client, 'active-connection-removed', queue),
        ];
        this.refresh();
    }

    _queueRefresh() {
        if (this._settleId)
            return;
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_DELAY_MS, () => {
            this._settleId = 0;
            Logger.guard('reading NetworkManager state', () => this.refresh());
            return GLib.SOURCE_REMOVE;
        });
    }

    // State and IP changes of the chosen connection don't always surface as
    // client-level notifications, so watch the objects we depend on directly.
    _watch(objects) {
        objects = objects.filter(Boolean);
        if (objects.length === this._watched.length &&
            objects.every((obj, i) => obj === this._watched[i][0]))
            return;
        this._unwatch();
        for (const obj of objects) {
            const id = connectSignal(obj, 'notify', (_obj, pspec) => {
                if (WATCHED_PROPERTIES.has(pspec.name))
                    this._queueRefresh();
            });
            this._watched.push([obj, id]);
        }
    }

    _unwatch() {
        for (const [obj, id] of this._watched)
            GObject.signal_handler_disconnect(obj, id);
        this._watched = [];
    }

    refresh() {
        if (!this.running)
            return;

        let info;
        try {
            const {uplink, vpn} = chooseConnections(this._client);
            this._watch([uplink, uplink?.get_devices()[0], vpn,
                uplink?.get_ip4_config(), uplink?.get_ip6_config()]);
            info = describeNetwork(this._client);
        } catch (e) {
            // Keep the last known state; the next notification retries.
            Logger.warn('NetworkManager detection failed:', e.message);
            return;
        }

        if (sameNetworkInfo(info, this._info))
            return;
        this._info = info;
        this.emit('changed', info);
    }

    destroy() {
        if (this._settleId) {
            GLib.source_remove(this._settleId);
            this._settleId = 0;
        }
        this._unwatch();
        for (const id of this._clientHandlers ?? [])
            GObject.signal_handler_disconnect(this._client, id);
        this._clientHandlers = null;
        this._client = null;
        this.disconnectAll();
    }
}
