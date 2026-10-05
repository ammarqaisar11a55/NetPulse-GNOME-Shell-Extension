import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {switchRow, group} from './Rows.js';
import {listInterfaces, classifyInterface} from '../network/KernelBackend.js';
import {InterfaceType} from '../network/InterfaceTypes.js';

const TYPE_LABELS = {
    [InterfaceType.ETHERNET]: () => _('Ethernet'),
    [InterfaceType.WIFI]: () => _('Wi-Fi'),
    [InterfaceType.USB_TETHERING]: () => _('USB Tethering'),
    [InterfaceType.MOBILE]: () => _('Mobile Broadband'),
    [InterfaceType.BLUETOOTH]: () => _('Bluetooth'),
    [InterfaceType.VPN]: () => _('VPN'),
    [InterfaceType.OTHER]: () => _('Other'),
};

export const NetworkPage = GObject.registerClass(
class NetworkPage extends Adw.PreferencesPage {
    constructor(settings) {
        super({title: _('Network'), icon_name: 'network-wired-symbolic', name: 'network'});
        this._settings = settings;

        const chosen = settings.get_string('manual-interface');
        this._names = listInterfaces();
        // Keep a chosen interface that is currently unplugged selectable.
        if (chosen && !this._names.includes(chosen))
            this._names.unshift(chosen);

        this._autoRow = new Adw.SwitchRow({
            title: _('Detect Automatically'),
            subtitle: _('Follow the connection that carries your internet traffic, including when it changes'),
            active: chosen === '',
        });

        this._interfaceRow = new Adw.ComboRow({
            title: _('Interface'),
            subtitle: _('Always measure this interface'),
            model: Gtk.StringList.new(this._names),
            selected: Math.max(0, this._names.indexOf(chosen)),
            sensitive: chosen !== '' && this._names.length > 0,
        });

        this._autoRow.connect('notify::active', () => this._apply());
        this._interfaceRow.connect('notify::selected', () => this._apply());

        this.add(group(_('Monitored Interface'), [this._autoRow, this._interfaceRow]));

        this._labelInterfaces().catch(e => console.warn('[NetPulse] Cannot classify interfaces:', e));

        this.add(group(_('Troubleshooting'), [
            switchRow(settings, 'debug-logging', _('Debug Logging'),
                _('Write detailed diagnostics to the system journal')),
        ]));
    }

    // Adds each interface's type ("wlo1 (Wi-Fi)") once it is known.
    async _labelInterfaces() {
        const types = await Promise.all(this._names.map(name => classifyInterface(name)));
        const labels = this._names.map((name, i) => `${name} (${TYPE_LABELS[types[i]]()})`);
        // Replacing the items must not count as the user picking another one.
        this._relabeling = true;
        const selected = this._interfaceRow.selected;
        this._interfaceRow.model.splice(0, labels.length, labels);
        this._interfaceRow.selected = selected;
        this._relabeling = false;
    }

    _apply() {
        if (this._relabeling)
            return;
        const auto = this._autoRow.active || this._names.length === 0;
        this._interfaceRow.sensitive = !auto;
        const value = auto ? '' : this._names[this._interfaceRow.selected] ?? '';
        if (value !== this._settings.get_string('manual-interface'))
            this._settings.set_string('manual-interface', value);
    }
});
