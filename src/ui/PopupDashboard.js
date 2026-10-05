// The popup shown when the panel indicator is clicked: live speeds, usage
// and details about the current network.
//
// Content is only refreshed while the menu is open, so a closed popup costs
// nothing beyond the panel label.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {StatRow, section, label, DIM_OPACITY} from './Widgets.js';
import {SpeedDisplay} from './SpeedDisplay.js';
import {UsageDisplay} from './UsageDisplay.js';
import {typeLabel, stateLabel, networkIcon} from './Labels.js';
import {ConnectionState} from '../network/InterfaceTypes.js';

const STATE_CLASSES = Object.values(ConnectionState).map(s => `netpulse-status-${s}`);

export class PopupDashboard {
    /**
     * @param {PopupMenu.PopupMenu} menu - the indicator's menu
     * @param {object} sources - data sources
     * @param {import('../network/SpeedMonitor.js').SpeedMonitor} sources.speedMonitor - speeds
     * @param {import('../network/InterfaceMonitor.js').InterfaceMonitor} sources.interfaceMonitor - network
     * @param {import('../usage/UsageTracker.js').UsageTracker} sources.usageTracker - usage
     * @param {import('../settings/SettingsManager.js').SettingsManager} sources.settings - settings
     */
    constructor(menu, {speedMonitor, interfaceMonitor, usageTracker, settings}) {
        this._menu = menu;
        this._speedMonitor = speedMonitor;
        this._interfaceMonitor = interfaceMonitor;
        this._usageTracker = usageTracker;
        this._settings = settings;

        this._menu.actor.add_style_class_name('netpulse-menu');
        this._build();

        this._handlers = [
            [speedMonitor, speedMonitor.connect('sample', () => this._whenOpen(() => this._updateSpeed()))],
            [usageTracker, usageTracker.connect('changed', () => this._whenOpen(() => this._updateUsage()))],
            [interfaceMonitor, interfaceMonitor.connect('changed', () => this._whenOpen(() => this._updateNetwork()))],
            [settings, settings.connect('display', () => this._whenOpen(() => this.refresh()))],
        ];
        this._menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this.refresh();
        });
    }

    _whenOpen(update) {
        if (this._menu.isOpen)
            update();
    }

    _addBlock(actor) {
        const block = new PopupMenu.PopupMenuSection();
        block.actor.add_style_class_name('netpulse-block');
        block.actor.add_child(actor);
        this._menu.addMenuItem(block);
    }

    _addSeparator() {
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _build() {
        // Header: what we're connected to.
        const header = new St.BoxLayout({style_class: 'netpulse-header', x_expand: true});
        this._networkIcon = new St.Icon({style_class: 'netpulse-header-icon', y_align: Clutter.ActorAlign.CENTER});
        const titles = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._networkTitle = label('netpulse-header-title');
        this._networkSubtitle = label('netpulse-header-subtitle', {opacity: DIM_OPACITY});
        titles.add_child(this._networkTitle);
        titles.add_child(this._networkSubtitle);
        this._status = label('netpulse-status');
        header.add_child(this._networkIcon);
        header.add_child(titles);
        header.add_child(this._status);
        this._addBlock(header);
        this._addSeparator();

        this._speedDisplay = new SpeedDisplay();
        this._addBlock(this._speedDisplay);
        this._addSeparator();

        this._usageDisplay = new UsageDisplay();
        this._addBlock(section(_('Usage'), [this._usageDisplay]));
        this._addSeparator();

        this._networkRows = {
            type: new StatRow(_('Connection')),
            iface: new StatRow(_('Interface')),
            ipv4: new StatRow(_('IPv4 Address')),
            ipv6: new StatRow(_('IPv6 Address')),
            vpn: new StatRow(_('VPN')),
        };
        this._addBlock(section(_('Network'), Object.values(this._networkRows)));
        this._addSeparator();

        const footer = new St.BoxLayout({style_class: 'netpulse-footer', x_expand: true});
        const resetButton = this._resetButton = new St.Button({
            style_class: 'button netpulse-footer-button',
            label: _('Reset Session'),
            can_focus: true,
            x_expand: true,
        });
        resetButton.connect('clicked', () => this._usageTracker.resetSession());
        footer.add_child(resetButton);
        this._addBlock(footer);
    }

    refresh() {
        this._updateNetwork();
        this._updateSpeed();
        this._updateUsage();
    }

    get _unitOptions() {
        const {bits, binary} = this._settings.display;
        return {bits, binary};
    }

    _updateSpeed() {
        this._speedDisplay.update(this._speedMonitor.current, this._unitOptions);
    }

    _updateUsage() {
        const totals = {session: this._usageTracker.session, ...this._usageTracker.totals};
        this._usageDisplay.update(totals, {binary: this._unitOptions.binary});
    }

    _updateNetwork() {
        const info = this._interfaceMonitor.info;
        const online = info.name !== null;

        this._networkIcon.icon_name = networkIcon(info);
        this._networkTitle.text = online
            ? info.connection ?? typeLabel(info.type)
            : _('No Network Connection');
        this._networkSubtitle.text = online ? `${typeLabel(info.type)} · ${info.name}` : _('Not connected');
        this._networkSubtitle.visible = online;

        this._status.text = stateLabel(info.state);
        STATE_CLASSES.forEach(c => this._status.remove_style_class_name(c));
        this._status.add_style_class_name(`netpulse-status-${info.state}`);

        const rows = this._networkRows;
        rows.type.value = online ? typeLabel(info.type) : '—';
        rows.iface.value = info.name ?? '—';
        rows.ipv4.value = info.ipv4 ?? '—';
        rows.ipv6.value = info.ipv6 ?? '';
        rows.ipv6.visible = info.ipv6 !== null;
        rows.vpn.value = info.vpn?.name ?? _('Off');
    }

    destroy() {
        for (const [source, id] of this._handlers)
            source.disconnect(id);
        this._handlers = [];
    }
}
