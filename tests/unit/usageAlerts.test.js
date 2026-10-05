import {test, assertEqual} from '../harness.js';
import {evaluateAlerts} from '../../src/usage/UsageAlerts.js';

const GB = 1e9;
const PERIODS = {daily: '2026-10-05', monthly: '2026-10'};
const usage = (today, month = today) => ({today: {rx: today, tx: 0}, month: {rx: month, tx: 0}});
const levels = result => result.alerts.map(a => `${a.period}:${a.level}`);

test('no limits means no alerts', () => {
    const r = evaluateAlerts({totals: usage(100 * GB), limits: {daily: 0, monthly: 0},
        percent: 80, periods: PERIODS, state: {}});
    assertEqual(r.alerts, []);
});

test('warning at the percentage, then once at the limit', () => {
    const limits = {daily: 5 * GB, monthly: 0};
    let state = {};
    const step = used => {
        const r = evaluateAlerts({totals: usage(used), limits, percent: 80, periods: PERIODS, state});
        state = r.state;
        return levels(r);
    };
    assertEqual(step(3.9 * GB), []);
    assertEqual(step(4 * GB), ['daily:warning']);
    assertEqual(step(4.5 * GB), [], 'no repeat');
    assertEqual(step(5 * GB), ['daily:limit']);
    assertEqual(step(9 * GB), [], 'no repeat after the limit');
});

test('crossing both thresholds at once shows only the limit alert', () => {
    const r = evaluateAlerts({totals: usage(6 * GB), limits: {daily: 5 * GB, monthly: 0},
        percent: 80, periods: PERIODS, state: {}});
    assertEqual(levels(r), ['daily:limit']);
    const again = evaluateAlerts({totals: usage(6 * GB), limits: {daily: 5 * GB, monthly: 0},
        percent: 80, periods: PERIODS, state: r.state});
    assertEqual(again.alerts, [], 'the skipped warning is not shown later');
});

test('a new day re-arms daily alerts but not monthly ones', () => {
    const limits = {daily: 1 * GB, monthly: 10 * GB};
    const first = evaluateAlerts({totals: usage(1 * GB, 9 * GB), limits, percent: 80, periods: PERIODS, state: {}});
    assertEqual(levels(first), ['daily:limit', 'monthly:warning']);
    const nextDay = evaluateAlerts({totals: usage(1 * GB, 9.5 * GB), limits, percent: 80,
        periods: {daily: '2026-10-06', monthly: '2026-10'}, state: first.state});
    assertEqual(levels(nextDay), ['daily:limit']);
});

test('changing the limit re-arms its alerts', () => {
    const r = evaluateAlerts({totals: usage(85 * GB), limits: {daily: 0, monthly: 100 * GB},
        percent: 80, periods: PERIODS, state: {}});
    assertEqual(levels(r), ['monthly:warning']);
    const raised = evaluateAlerts({totals: usage(85 * GB), limits: {daily: 0, monthly: 200 * GB},
        percent: 80, periods: PERIODS, state: r.state});
    assertEqual(raised.alerts, [], 'below the new threshold');
    const lowered = evaluateAlerts({totals: usage(85 * GB), limits: {daily: 0, monthly: 90 * GB},
        percent: 80, periods: PERIODS, state: raised.state});
    assertEqual(levels(lowered), ['monthly:warning']);
    assertEqual(lowered.alerts[0].used, 85 * GB);
});

test('alerts count download and upload together', () => {
    const r = evaluateAlerts({totals: {today: {rx: 3 * GB, tx: 1 * GB}, month: {rx: 0, tx: 0}},
        limits: {daily: 5 * GB, monthly: 0}, percent: 80, periods: PERIODS, state: {}});
    assertEqual(levels(r), ['daily:warning']);
});
