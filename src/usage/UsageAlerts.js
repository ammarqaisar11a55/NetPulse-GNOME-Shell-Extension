// Decides when to warn about data limits. Pure: the caller supplies totals
// and the bookkeeping of what was already announced, and gets back the
// alerts to show plus updated bookkeeping (persisted with the usage data, so
// restarts never repeat an alert).
//
// Each limit produces at most two alerts per period: one at the configured
// percentage and one when the limit is reached. Changing the limit re-arms
// them; so does a new day or month.

export const AlertLevel = Object.freeze({WARNING: 'warning', LIMIT: 'limit'});

/**
 * @typedef {object} Alert
 * @property {string} period - "daily" or "monthly"
 * @property {string} level - one of AlertLevel
 * @property {number} used - bytes used in the period
 * @property {number} limit - limit in bytes
 * @property {number} percent - warning threshold in percent
 */

/**
 * @param {object} params - inputs
 * @param {{today: {rx: number, tx: number}, month: {rx: number, tx: number}}} params.totals -
 *   usage so far
 * @param {{daily: number, monthly: number}} params.limits - limits in bytes, 0 for none
 * @param {number} params.percent - warning threshold (1-99)
 * @param {{daily: string, monthly: string}} params.periods - current period keys
 * @param {object} params.state - bookkeeping from the previous call
 * @returns {{alerts: Alert[], state: object}}
 */
export function evaluateAlerts({totals, limits, percent, periods, state}) {
    const alerts = [];
    const next = {};

    for (const [period, usage] of [['daily', totals.today], ['monthly', totals.month]]) {
        const limit = limits[period];
        const previous = state?.[period];
        const sent = previous?.key === periods[period] ? [...previous.sent] : [];
        next[period] = {key: periods[period], sent};
        if (!(limit > 0))
            continue;

        const used = usage.rx + usage.tx;
        const crossed = [];
        if (used >= limit)
            crossed.push(AlertLevel.LIMIT, AlertLevel.WARNING);
        else if (used >= limit * percent / 100)
            crossed.push(AlertLevel.WARNING);

        const fresh = crossed.filter(level => !sent.includes(`${level}@${limit}`));
        if (fresh.length === 0)
            continue;
        // Crossing both at once (e.g. after a large download) shows only the
        // more important alert.
        alerts.push({period, level: fresh[0], used, limit, percent});
        for (const level of crossed) {
            if (!sent.includes(`${level}@${limit}`))
                sent.push(`${level}@${limit}`);
        }
    }
    return {alerts, state: next};
}
