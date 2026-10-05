// Shows GNOME Shell notifications under a "NetPulse" source.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export const Urgency = MessageTray.Urgency;

export class Notifier {
    constructor() {
        this._source = null;
    }

    // The shell destroys a source once its last notification is gone, so it
    // is created on demand.
    _getSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({
                title: _('NetPulse'),
                iconName: 'network-transmit-receive-symbolic',
            });
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    /**
     * @param {object} params - notification content
     * @param {string} params.title - title
     * @param {string} params.body - body text
     * @param {string} [params.iconName] - symbolic icon name
     * @param {number} [params.urgency] - one of Urgency
     * @param {boolean} [params.isTransient] - drop it from the message list
     *   once the banner is gone
     * @returns {MessageTray.Notification}
     */
    notify({title, body, iconName, urgency = Urgency.NORMAL, isTransient = false}) {
        const source = this._getSource();
        const notification = new MessageTray.Notification({
            source,
            title,
            body,
            urgency,
            isTransient,
            ...iconName ? {iconName} : {},
        });
        source.addNotification(notification);
        return notification;
    }

    destroy() {
        this._source?.destroy();
        this._source = null;
    }
}
