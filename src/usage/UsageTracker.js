// Accumulates transferred bytes reported by the speed monitor.

import {EventEmitter} from '../utils/Signals.js';

export class UsageTracker extends EventEmitter {
    constructor() {
        super();
        this._session = {rx: 0, tx: 0};
    }

    /** @returns {{rx: number, tx: number}} bytes since the session started */
    get session() {
        return {...this._session};
    }

    /**
     * @param {number} rx - bytes received
     * @param {number} tx - bytes sent
     */
    add(rx, tx) {
        if (rx <= 0 && tx <= 0)
            return;
        this._session.rx += rx;
        this._session.tx += tx;
        this.emit('changed');
    }

    resetSession() {
        this._session = {rx: 0, tx: 0};
        this.emit('changed');
    }

    destroy() {
        this.disconnectAll();
    }
}
