// Derives period totals and series from stored usage data. Pure functions;
// all dates are local time.

/**
 * @param {import('gi://GLib').default.DateTime} date - a local date/time
 * @returns {string} "YYYY-MM-DD"
 */
export const dayKey = date => date.format('%Y-%m-%d');

/**
 * @param {import('gi://GLib').default.DateTime} date - a local date/time
 * @returns {string} "YYYY-MM"
 */
export const monthKey = date => date.format('%Y-%m');

const ZERO = Object.freeze({rx: 0, tx: 0});

/**
 * @param {import('./UsageStorage.js').UsageData} data - usage data
 * @param {import('gi://GLib').default.DateTime} date - any time on the day
 * @returns {{rx: number, tx: number}}
 */
export function dayTotals(data, date) {
    const day = data.days[dayKey(date)];
    return day ? {rx: day.rx, tx: day.tx} : {...ZERO};
}

/**
 * @param {import('gi://GLib').default.DateTime} now - current time
 * @param {number} weekStart - first day of the week (0 = Sunday ... 6)
 * @returns {number} days elapsed since the start of the current week
 */
export function daysIntoWeek(now, weekStart) {
    const weekday = now.get_day_of_week() % 7; // GLib: Monday = 1 ... Sunday = 7
    return (weekday - weekStart + 7) % 7;
}

/**
 * @param {import('./UsageStorage.js').UsageData} data - usage data
 * @param {import('gi://GLib').default.DateTime} now - current time
 * @param {number} [weekStart] - first day of the week (0 = Sunday ... 6)
 * @returns {{today, yesterday, week, month}} totals, each {rx, tx}
 */
export function periodTotals(data, now, weekStart = 1) {
    const week = {rx: 0, tx: 0};
    for (let i = daysIntoWeek(now, weekStart); i >= 0; i--) {
        const day = dayTotals(data, now.add_days(-i));
        week.rx += day.rx;
        week.tx += day.tx;
    }
    const month = data.months[monthKey(now)];
    return {
        today: dayTotals(data, now),
        yesterday: dayTotals(data, now.add_days(-1)),
        week,
        month: month ? {rx: month.rx, tx: month.tx} : {...ZERO},
    };
}

/**
 * @param {import('./UsageStorage.js').UsageData} data - usage data
 * @param {import('gi://GLib').default.DateTime} now - current time
 * @param {number} count - number of days, ending today
 * @returns {{date: import('gi://GLib').default.DateTime, rx: number, tx: number}[]}
 *   oldest first
 */
export function dailySeries(data, now, count) {
    const series = [];
    for (let i = count - 1; i >= 0; i--) {
        const date = now.add_days(-i);
        series.push({date, ...dayTotals(data, date)});
    }
    return series;
}

/**
 * @param {import('./UsageStorage.js').UsageData} data - usage data
 * @param {import('gi://GLib').default.DateTime} date - the day
 * @returns {{hour: number, rx: number, tx: number}[]} 24 entries
 */
export function hourlySeries(data, date) {
    const day = data.days[dayKey(date)];
    return Array.from({length: 24}, (_, hour) => ({
        hour,
        rx: day?.hrx?.[hour] ?? 0,
        tx: day?.htx?.[hour] ?? 0,
    }));
}
