// Minimal signal emitter for plain JS classes.
//
// The monitoring classes deliberately avoid GObject and Shell-only modules so
// they can be unit tested with plain `gjs`.

export class EventEmitter {
    #handlers = new Map();
    #nextId = 1;

    /**
     * @param {string} name - signal name
     * @param {Function} callback - invoked with the emitted arguments
     * @returns {number} handler id for disconnect()
     */
    connect(name, callback) {
        const id = this.#nextId++;
        this.#handlers.set(id, {name, callback});
        return id;
    }

    /** @param {number} id - handler id returned by connect() */
    disconnect(id) {
        this.#handlers.delete(id);
    }

    disconnectAll() {
        this.#handlers.clear();
    }

    /**
     * @param {string} name - signal name
     * @param {...any} args - forwarded to every handler
     */
    emit(name, ...args) {
        // Copy so handlers may disconnect themselves while we iterate.
        for (const {name: n, callback} of [...this.#handlers.values()]) {
            if (n !== name)
                continue;
            try {
                callback(...args);
            } catch (e) {
                console.error(`[NetPulse] Error in '${name}' handler:`, e);
            }
        }
    }
}
