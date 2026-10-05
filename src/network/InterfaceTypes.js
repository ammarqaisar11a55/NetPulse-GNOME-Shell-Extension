// Shared vocabulary for describing the network NetPulse is monitoring.
// Display labels live in the UI layer so this module stays translation-free.

export const InterfaceType = Object.freeze({
    ETHERNET: 'ethernet',
    WIFI: 'wifi',
    USB_TETHERING: 'usb-tethering',
    MOBILE: 'mobile',
    BLUETOOTH: 'bluetooth',
    VPN: 'vpn',
    OTHER: 'other',
});

export const ConnectionState = Object.freeze({
    CONNECTED: 'connected',
    // Connected to a network, but no (or captive-portal) internet access.
    LIMITED: 'limited',
    CONNECTING: 'connecting',
    DISCONNECTED: 'disconnected',
});

// USB network drivers used by phones for tethering. Generic CDC drivers
// (cdc_ether, cdc_ncm) are left out because USB Ethernet dongles use them too.
export const TETHERING_DRIVERS = new Set(['rndis_host', 'ipheth']);

export const MOBILE_DRIVERS = new Set(['qmi_wwan', 'cdc_mbim', 'huawei_cdc_ncm']);

/**
 * Describes the current network as seen by NetPulse.
 *
 * `name` is the kernel interface whose counters are sampled. When a VPN is
 * active this stays the physical uplink, so usage matches what the ISP sees
 * and toggling the VPN does not disturb measurements; the tunnel itself is
 * reported in `vpn`.
 *
 * @typedef {object} NetworkInfo
 * @property {string|null} name - kernel interface name, e.g. "wlp2s0"
 * @property {string} type - one of InterfaceType
 * @property {string|null} connection - connection name or Wi-Fi SSID
 * @property {string} state - one of ConnectionState
 * @property {string|null} ipv4 - primary IPv4 address
 * @property {string|null} ipv6 - primary global IPv6 address
 * @property {{name: string, iface: string|null}|null} vpn - active VPN
 * @property {string} source - "networkmanager", "kernel" or "manual"
 */

/**
 * @param {Partial<NetworkInfo>} fields - values to override
 * @returns {NetworkInfo}
 */
export function makeNetworkInfo(fields = {}) {
    return {
        name: null,
        type: InterfaceType.OTHER,
        connection: null,
        state: ConnectionState.DISCONNECTED,
        ipv4: null,
        ipv6: null,
        vpn: null,
        source: 'kernel',
        ...fields,
    };
}

/**
 * @param {NetworkInfo} a - first info
 * @param {NetworkInfo} b - second info
 * @returns {boolean} whether both describe the same network state
 */
export function sameNetworkInfo(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * @param {NetworkInfo} info - network info
 * @returns {boolean} whether the network is usable for traffic
 */
export function isOnline(info) {
    return info.name !== null &&
        (info.state === ConnectionState.CONNECTED ||
         info.state === ConnectionState.LIMITED);
}
