import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {test, assert, assertEqual, assertThrows, makeTempDir, writeFile} from '../harness.js';
import {UsageStorage, sanitize, emptyData} from '../../src/usage/UsageStorage.js';
import {periodTotals, dailySeries, hourlySeries, daysIntoWeek} from '../../src/usage/UsageStatistics.js';
import {UsageTracker} from '../../src/usage/UsageTracker.js';

// Monday, 5 October 2026, 13:30 local time.
const MONDAY = GLib.DateTime.new_local(2026, 10, 5, 13, 30, 0);
const GB = 1e9;

const readFile = path => new TextDecoder().decode(GLib.file_get_contents(path)[1]);

/**
 * @param {object} [opts] - tracker options
 * @returns {Promise<{tracker: UsageTracker, clock: {now: GLib.DateTime}, storage: UsageStorage, dir: string}>}
 */
async function makeTracker(opts = {}) {
    const dir = opts.dir ?? makeTempDir();
    const storage = opts.storage ?? new UsageStorage(`${dir}/usage.json`);
    const clock = {now: opts.now ?? MONDAY};
    const tracker = new UsageTracker({
        storage,
        bootId: opts.bootId ?? 'boot-1',
        sessionId: opts.sessionId ?? 'boot-1:100',
        weekStart: opts.weekStart ?? 1,
        retentionDays: opts.retentionDays,
        clock: () => clock.now,
    });
    await tracker.load();
    return {tracker, clock, storage, dir};
}

// ---- Storage ----------------------------------------------------------------

test('storage round-trips data with private permissions', async () => {
    const dir = makeTempDir();
    const storage = new UsageStorage(`${dir}/sub/usage.json`);
    const data = emptyData();
    data.days['2026-10-05'] = {rx: 5, tx: 6};
    data.months['2026-10'] = {rx: 5, tx: 6};
    assert(await storage.save(data, '2026-10-05'), 'saved');
    assertEqual((await new UsageStorage(`${dir}/sub/usage.json`).load()), data);

    const info = Gio.File.new_for_path(`${dir}/sub/usage.json`).query_info('unix::mode', 0, null);
    assertEqual(info.get_attribute_uint32('unix::mode') & 0o777, 0o600);
});

test('storage starts empty when no file exists', async () => {
    assertEqual(await new UsageStorage(`${makeTempDir()}/usage.json`).load(), emptyData());
});

test('storage recovers from a corrupt file using the daily backup', async () => {
    const dir = makeTempDir();
    const storage = new UsageStorage(`${dir}/usage.json`);
    const data = emptyData();
    data.days['2026-10-04'] = {rx: 1, tx: 2};
    await storage.save(data, '2026-10-04');

    writeFile(`${dir}/usage.json`, '{"version": 1, "days": {"2026-10-05": {"rx": 9');
    const loaded = (await new UsageStorage(`${dir}/usage.json`).load());
    assertEqual(loaded.days, {'2026-10-04': {rx: 1, tx: 2}});

    const names = [];
    const it = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
    for (let f; (f = it.next_file(null));)
        names.push(f.get_name());
    assert(names.some(n => n.startsWith('usage.json.corrupt-')), 'corrupt file kept aside');
});

test('storage falls back to empty data when the backup is corrupt too', async () => {
    const dir = makeTempDir();
    writeFile(`${dir}/usage.json`, 'not json');
    writeFile(`${dir}/usage.json.bak`, '[]');
    assertEqual((await new UsageStorage(`${dir}/usage.json`).load()), emptyData());
});

test('backup is refreshed once per day', async () => {
    const dir = makeTempDir();
    const storage = new UsageStorage(`${dir}/usage.json`);
    const data = emptyData();
    data.days['2026-10-05'] = {rx: 1, tx: 1};
    await storage.save(data, '2026-10-05');
    data.days['2026-10-05'].rx = 2;
    await storage.save(data, '2026-10-05');
    assertEqual(JSON.parse(readFile(`${dir}/usage.json.bak`)).days['2026-10-05'].rx, 1);
    await storage.save(data, '2026-10-06');
    assertEqual(JSON.parse(readFile(`${dir}/usage.json.bak`)).days['2026-10-05'].rx, 2);
});

test('sanitize keeps valid entries and drops malformed ones', () => {
    const data = sanitize({
        version: 1,
        days: {
            '2026-10-05': {rx: 10, tx: 20, hrx: new Array(24).fill(1), htx: new Array(24).fill(0)},
            '2026-10-04': {rx: -1, tx: 5},
            'garbage': {rx: 1, tx: 1},
            '2026-10-03': {rx: 1, tx: 1, hrx: [1, 2], htx: [3]},
        },
        months: {'2026-10': {rx: 'x', tx: 1}, '2026-09': {rx: 1, tx: 1}},
        session: {id: 7, rx: 1, tx: 1},
        counters: {bootId: 'b', iface: 'wlo1', rx: 1, tx: 2},
    });
    assertEqual(Object.keys(data.days).sort(), ['2026-10-03', '2026-10-05']);
    assertEqual(data.days['2026-10-03'], {rx: 1, tx: 1});
    assertEqual(data.days['2026-10-05'].hrx.length, 24);
    assertEqual(Object.keys(data.months), ['2026-09']);
    assertEqual(data.session, null);
    assertEqual(data.counters, {bootId: 'b', iface: 'wlo1', rx: 1, tx: 2});
});

test('sanitize rejects non-usage data and newer formats', () => {
    assertThrows(() => sanitize(null));
    assertThrows(() => sanitize([]));
    assertThrows(() => sanitize({version: 99, days: {}}));
});

// ---- Statistics --------------------------------------------------------------

test('daysIntoWeek honors the locale week start', () => {
    assertEqual(daysIntoWeek(MONDAY, 1), 0);
    assertEqual(daysIntoWeek(MONDAY, 0), 1);
    assertEqual(daysIntoWeek(MONDAY.add_days(6), 1), 6); // Sunday
    assertEqual(daysIntoWeek(MONDAY.add_days(6), 0), 0);
});

test('periodTotals sums today, yesterday, week and month', () => {
    const data = emptyData();
    data.days['2026-10-05'] = {rx: 1, tx: 10};       // Monday
    data.days['2026-10-04'] = {rx: 2, tx: 20};       // Sunday
    data.days['2026-09-28'] = {rx: 4, tx: 40};       // previous Monday
    data.months['2026-10'] = {rx: 3, tx: 30};
    const mondayStart = periodTotals(data, MONDAY, 1);
    assertEqual(mondayStart.today, {rx: 1, tx: 10});
    assertEqual(mondayStart.yesterday, {rx: 2, tx: 20});
    assertEqual(mondayStart.week, {rx: 1, tx: 10});
    assertEqual(mondayStart.month, {rx: 3, tx: 30});
    assertEqual(periodTotals(data, MONDAY, 0).week, {rx: 3, tx: 30});
});

test('dailySeries and hourlySeries fill gaps with zeros', () => {
    const data = emptyData();
    data.days['2026-10-03'] = {rx: 7, tx: 0};
    const series = dailySeries(data, MONDAY, 3);
    assertEqual(series.map(d => d.date.format('%d')), ['03', '04', '05']);
    assertEqual(series.map(d => d.rx), [7, 0, 0]);
    assertEqual(dailySeries(data, MONDAY, 30).length, 30);

    data.days['2026-10-05'] = {rx: 5, tx: 5, hrx: new Array(24).fill(0), htx: new Array(24).fill(0)};
    data.days['2026-10-05'].hrx[13] = 5;
    const hours = hourlySeries(data, MONDAY);
    assertEqual(hours.length, 24);
    assertEqual(hours[13], {hour: 13, rx: 5, tx: 0});
    assertEqual(hourlySeries(data, MONDAY.add_days(-1))[0], {hour: 0, rx: 0, tx: 0});
});

// ---- Tracker -----------------------------------------------------------------

test('tracker attributes traffic to session, hour, day and month', async () => {
    const {tracker} = await makeTracker();
    tracker.add(2 * GB, 1 * GB);
    tracker.add(500, 0);
    const day = tracker.data.days['2026-10-05'];
    assertEqual([day.rx, day.tx], [2 * GB + 500, GB]);
    assertEqual(day.hrx[13], 2 * GB + 500);
    assertEqual(tracker.data.months['2026-10'], {rx: 2 * GB + 500, tx: GB});
    assertEqual(tracker.session, {rx: 2 * GB + 500, tx: GB});
    assertEqual(tracker.totals.today, {rx: 2 * GB + 500, tx: GB});
});

test('tracker persists across restarts and keeps the session per login', async () => {
    const {tracker, dir} = await makeTracker();
    tracker.add(100, 50);
    await tracker.destroy();

    const sameSession = (await makeTracker({dir})).tracker;
    assertEqual(sameSession.totals.today, {rx: 100, tx: 50});
    assertEqual(sameSession.session, {rx: 100, tx: 50}, 'lock/unlock keeps the session');

    const newSession = (await makeTracker({dir, sessionId: 'boot-2:200', bootId: 'boot-2'})).tracker;
    assertEqual(newSession.totals.today, {rx: 100, tx: 50}, 'history survives a reboot');
    assertEqual(newSession.session, {rx: 0, tx: 0}, 'a new login starts a new session');
});

test('tracker only writes when something changed', async () => {
    let saves = 0;
    const storage = {load: () => emptyData(), save: () => ++saves > 0};
    const {tracker} = await makeTracker({storage});
    await tracker.save();
    assertEqual(saves, 1, 'new session is saved');
    tracker.add(0, 0, {iface: 'wlo1', rx: 10, tx: 10});
    await tracker.save();
    assertEqual(saves, 2, 'first counters baseline is saved');
    tracker.add(0, 0, {iface: 'wlo1', rx: 10, tx: 10});
    await tracker.save();
    assertEqual(saves, 2, 'idle samples cause no writes');
    tracker.add(1, 0, {iface: 'wlo1', rx: 11, tx: 10});
    await tracker.save();
    assertEqual(saves, 3);
});

test('tracker recovers traffic from kernel counters within the same boot', async () => {
    const {tracker, dir} = await makeTracker();
    tracker.add(100, 100, {iface: 'wlo1', rx: 1000, tx: 2000});
    await tracker.destroy();

    // The screen was locked; 5000/700 more bytes went through meanwhile.
    const resumed = (await makeTracker({dir})).tracker;
    const recovered = await resumed.catchUp(() => ({rx: 6000, tx: 2700}));
    assertEqual(recovered, {rx: 5000, tx: 700});
    assertEqual(resumed.totals.today, {rx: 5100, tx: 800});
    assertEqual(resumed.session, {rx: 5100, tx: 800});
    assertEqual(resumed.data.counters, {bootId: 'boot-1', iface: 'wlo1', rx: 6000, tx: 2700});
});

test('tracker does not recover across reboots or counter resets', async () => {
    const {tracker, dir} = await makeTracker();
    tracker.add(1, 1, {iface: 'wlo1', rx: 1000, tx: 1000});
    await tracker.destroy();

    const rebooted = (await makeTracker({dir, bootId: 'boot-2'})).tracker;
    assertEqual(await rebooted.catchUp(() => ({rx: 9000, tx: 9000})), null);

    const reset = (await makeTracker({dir})).tracker;
    assertEqual(await reset.catchUp(() => ({rx: 10, tx: 10})), null, 'interface was recreated');
    assertEqual(await reset.catchUp(() => null), null, 'interface is gone');
    assertEqual(reset.totals.today, {rx: 1, tx: 1});
});

test('tracker handles day and month rollover', async () => {
    const {tracker, clock} = await makeTracker({now: GLib.DateTime.new_local(2026, 9, 30, 23, 59, 0)});
    tracker.add(10, 0);
    clock.now = GLib.DateTime.new_local(2026, 10, 1, 0, 1, 0);
    tracker.add(20, 0);
    assertEqual(tracker.totals.today, {rx: 20, tx: 0});
    assertEqual(tracker.totals.yesterday, {rx: 10, tx: 0});
    assertEqual(tracker.totals.month, {rx: 20, tx: 0});
    assertEqual(tracker.data.months['2026-09'], {rx: 10, tx: 0});
    assertEqual(tracker.data.days['2026-10-01'].hrx[0], 20);
});

test('tracker prunes history beyond the retention period', async () => {
    const {tracker, clock} = await makeTracker({retentionDays: 30});
    tracker.add(1, 1);
    clock.now = MONDAY.add_days(29);
    tracker.add(1, 1);
    assert('2026-10-05' in tracker.data.days, 'kept on the last retained day');
    assert(!tracker.data.days['2026-10-05'].hrx, 'hourly detail dropped after a week');
    clock.now = MONDAY.add_days(30);
    tracker.add(1, 1);
    assert(!('2026-10-05' in tracker.data.days), 'dropped after the retention period');
});

test('resetAll clears history but keeps the counters baseline', async () => {
    const {tracker} = await makeTracker();
    tracker.add(5, 5, {iface: 'wlo1', rx: 50, tx: 50});
    tracker.resetAll();
    assertEqual(tracker.totals.today, {rx: 0, tx: 0});
    assertEqual(tracker.session, {rx: 0, tx: 0});
    assertEqual(tracker.data.counters.rx, 50);
});

test('tracker writes data recovered from the backup back immediately', async () => {
    const {tracker, dir} = await makeTracker();
    tracker.add(42, 0);
    await tracker.destroy();
    writeFile(`${dir}/usage.json`, '{"broken');

    const recovered = (await makeTracker({dir})).tracker;
    assertEqual(recovered.totals.today.rx, 42);
    assertEqual(JSON.parse(readFile(`${dir}/usage.json`)).days['2026-10-05'].rx, 42,
        'main file restored without waiting for new traffic');
});

test('paused tracking records nothing but keeps the counters baseline', async () => {
    const {tracker, dir} = await makeTracker();
    tracker.setEnabled(false);
    tracker.add(100, 100, {iface: 'wlo1', rx: 5000, tx: 5000});
    assertEqual(tracker.totals.today, {rx: 0, tx: 0});
    assertEqual(tracker.data.counters.rx, 5000, 'baseline follows the counters');
    await tracker.destroy();

    const paused = (await makeTracker({dir})).tracker;
    paused.setEnabled(false);
    assertEqual(await paused.catchUp(() => ({rx: 9000, tx: 9000})), null, 'no catch-up while paused');
});

test('reset requests are applied once, also across restarts', async () => {
    const {tracker, dir} = await makeTracker();
    tracker.add(10, 10);
    tracker.applyResetRequest(1000);
    assertEqual(tracker.totals.today, {rx: 0, tx: 0});
    tracker.add(5, 5);
    tracker.applyResetRequest(1000);
    assertEqual(tracker.totals.today, {rx: 5, tx: 5}, 'the same request is not applied twice');
    await tracker.destroy();

    const restarted = (await makeTracker({dir})).tracker;
    restarted.applyResetRequest(1000);
    assertEqual(restarted.totals.today, {rx: 5, tx: 5}, 'applied requests are remembered');
    restarted.applyResetRequest(2000);
    assertEqual(restarted.totals.today, {rx: 0, tx: 0}, 'a newer request resets');
});
