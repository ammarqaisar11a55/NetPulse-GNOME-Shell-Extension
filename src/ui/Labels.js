// Translatable display names and icons for network types and states.

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {InterfaceType, ConnectionState} from '../network/InterfaceTypes.js';

/**
 * @param {string} type - one of InterfaceType
 * @returns {string} display name
 */
export function typeLabel(type) {
    switch (type) {
    case InterfaceType.ETHERNET: return _('Ethernet');
    case InterfaceType.WIFI: return _('Wi-Fi');
    case InterfaceType.USB_TETHERING: return _('USB Tethering');
    case InterfaceType.MOBILE: return _('Mobile Broadband');
    case InterfaceType.BLUETOOTH: return _('Bluetooth');
    case InterfaceType.VPN: return _('VPN');
    default: return _('Network');
    }
}

/**
 * @param {string} state - one of ConnectionState
 * @returns {string} display name
 */
export function stateLabel(state) {
    switch (state) {
    case ConnectionState.CONNECTED: return _('Connected');
    case ConnectionState.LIMITED: return _('Limited Connectivity');
    case ConnectionState.CONNECTING: return _('Connecting');
    default: return _('Disconnected');
    }
}

/**
 * @param {import('../network/InterfaceTypes.js').NetworkInfo} info - network
 * @returns {string} symbolic icon name
 */
export function networkIcon(info) {
    if (!info.name)
        return 'network-offline-symbolic';
    const limited = info.state === ConnectionState.LIMITED;
    switch (info.type) {
    case InterfaceType.WIFI:
        return limited ? 'network-wireless-no-route-symbolic' : 'network-wireless-symbolic';
    case InterfaceType.MOBILE:
        return 'network-cellular-symbolic';
    case InterfaceType.USB_TETHERING:
        return 'phone-symbolic';
    case InterfaceType.BLUETOOTH:
        return 'bluetooth-active-symbolic';
    case InterfaceType.VPN:
        return 'network-vpn-symbolic';
    default:
        return limited ? 'network-wired-no-route-symbolic' : 'network-wired-symbolic';
    }
}
