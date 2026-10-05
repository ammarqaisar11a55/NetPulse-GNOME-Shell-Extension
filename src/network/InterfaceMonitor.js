// Tracks which network interface NetPulse should measure.
//
// NetworkManager is used when it is running; otherwise, or when the
// interface it reports is not visible to us (e.g. inside a container's
// network namespace), detection falls back to the kernel's routing table.

import {EventEmitter} from '../utils/Signals.js';
import * as Logger from '../utils/Logger.js';
import {KernelBackend, hasStatistics} from './KernelBackend.js';
import {NMBackend} from './NMBackend.js';
import {makeNetworkInfo, sameNetworkInfo, isOnline} from './InterfaceTypes.js';

export class InterfaceMonitor extends EventEmitter {
    /**
     * @param {object} [options] - options
     * @param {boolean} [options.useNetworkManager] - try NetworkManager first
     * @param {string} [options.sysRoot] - sysfs network class directory
     * @param {string} [options.procRoot] - procfs mount point
     */
    constructor({useNetworkManager = true, sysRoot, procRoot} = {}) {
        super();
        this._useNM = useNetworkManager;
        this._roots = {sysRoot, procRoot};
        this._info = makeNetworkInfo();
        this._nm = null;
        this._kernel = null;
        this._manual = null;
        this._destroyed = false;
    }

    /**
     * @param {string|null} name - interface to monitor regardless of routing,
     *   or null to follow the active connection
     */
    setManualInterface(name) {
        if (name === this._manual)
            return;
        this._manual = name;
        Logger.info(name ? `Monitoring ${name} (chosen in preferences)` : 'Detecting the active interface automatically');
        this._kernel?.setManualInterface(name);
        this._update();
    }

    /** @returns {import('./InterfaceTypes.js').NetworkInfo} */
    get info() {
        return this._info;
    }

    async start() {
        if (this._useNM) {
            const nm = await NMBackend.create();
            if (this._destroyed) {
                nm?.destroy();
                return;
            }
            this._nm = nm;
        }

        if (this._nm) {
            this._nm.connect('changed', () => this._update());
            this._nm.connect('running-changed', running => {
                Logger.info(running ? 'NetworkManager started' : 'NetworkManager stopped');
                this._update();
            });
            this._nm.start();
        }
        this._update();
        Logger.info(`Network detection started (${this._info.source})`);
    }

    _ensureKernel() {
        if (this._kernel)
            return;
        this._kernel = new KernelBackend({...this._roots, manualInterface: this._manual});
        this._kernel.connect('changed', () => this._update());
        this._kernel.start();
    }

    _stopKernel() {
        this._kernel?.destroy();
        this._kernel = null;
    }

    _resolve() {
        if (this._manual) {
            // NetworkManager knows more (connection name, connectivity) when it
            // manages the chosen interface; otherwise ask the kernel.
            const info = this._nm?.running ? this._nm.info : null;
            if (info?.name === this._manual) {
                this._stopKernel();
                return {...info, source: 'manual'};
            }
            this._ensureKernel();
            return this._kernel.info;
        }

        if (this._nm?.running) {
            const info = this._nm.info;
            if (!info.name || hasStatistics(info.name, this._roots.sysRoot)) {
                this._stopKernel();
                return info;
            }
            Logger.debug(`NetworkManager reports ${info.name}, which is not visible here`);
        }
        this._ensureKernel();
        return this._kernel.info;
    }

    _update() {
        if (this._destroyed)
            return;

        const info = this._resolve();
        if (sameNetworkInfo(info, this._info))
            return;

        const previous = this._info;
        this._info = info;
        this._logTransition(previous, info);
        this.emit('changed', info);
    }

    _logTransition(previous, info) {
        if (previous.name !== info.name) {
            if (!info.name)
                Logger.info(`Network disconnected (was ${previous.name})`);
            else if (!previous.name)
                Logger.info(`Network connected: ${info.name} (${info.type})`);
            else
                Logger.info(`Network interface changed: ${previous.name} → ${info.name}`);
        } else if (isOnline(previous) !== isOnline(info) || previous.state !== info.state) {
            Logger.info(`Network ${info.name ?? ''} state: ${previous.state} → ${info.state}`);
        }

        if (previous.vpn?.name !== info.vpn?.name) {
            if (info.vpn)
                Logger.info(`VPN active: ${info.vpn.name}`);
            else
                Logger.info(`VPN inactive (was ${previous.vpn.name})`);
        }
        Logger.debug('Network info:', JSON.stringify(info));
    }

    destroy() {
        this._destroyed = true;
        this._nm?.destroy();
        this._nm = null;
        this._stopKernel();
        this.disconnectAll();
    }
}
