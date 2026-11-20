/**
 * Activity numbers for the Dictation and Live pages, counted in the main process so the
 * renderer only ever receives numbers. Days are local calendar days. No value imports, so
 * the script tests can load this file directly.
 */

export const ACTIVITY_KINDS = ['dictation', 'live'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_RANGES = [7, 30] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];
/** Weeks drawn in the heatmap, Monday to Sunday columns ending with the current week: half a year fills the drawer. */
export const ACTIVITY_WEEKS = 26;

const DAY_MS = 86_400_000;
/** Below this much audio a words-a-minute figure means nothing. */
const MIN_PACE_MS = 5_000;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** One saved transcript, reduced to what the numbers need. */
export interface ActivityRow {
  text: string;
  durationMs: number;
  createdAt: number;
  /** The recognition model that made it. Older callers may leave both out. */
  modelId?: string;
  /** Milliseconds the model spent on it on this computer. */
  inferenceMs?: number;
}

/** One recognition model's share of the range. */
export interface ActivityModel {
  id: string;
  words: number;
  takes: number;
  /** Milliseconds of audio. */
  ms: number;
  /** Milliseconds spent transcribing, for the speed figure. */
  inferenceMs: number;
  /** Words per day across the range, oldest first, today last. */
  dailyWords: number[];
  /** Milliseconds of audio per day across the range. */
  dailyMs: number[];
}

export interface ActivityTotals {
  words: number;
  takes: number;
  /** Milliseconds of audio. */
  ms: number;
  /** Words a minute, 0 when there is too little audio to say. */
  pace: number;
}

export interface Activity extends ActivityTotals {
  days: ActivityRange;
  /** The same totals for the `days` before the range, for the change line. */
  previous: ActivityTotals;
  /** Words per day across the range, oldest first, today last. */
  daily: number[];
  /** The models used in the range, most words first. */
  models: ActivityModel[];
  /** Words per day for ACTIVITY_WEEKS full weeks from `heatmapStart`; days after today are 0. */
  heatmap: number[];
  /** Local midnight of the first heatmap day, a Monday. */
  heatmapStart: number;
  /** Local midnight of today. */
  today: number;
  /** Days in a row with at least one transcript: the run reaching today (or yesterday) and the longest ever. */
  streak: { current: number; longest: number };
}

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Calendar arithmetic, so a daylight-saving day is still one day. */
export function addDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function dayIndex(from: number, ms: number): number {
  return Math.round((startOfDay(ms) - from) / DAY_MS);
}

export function heatmapStartOf(now: number): number {
  const today = startOfDay(now);
  const sinceMonday = (new Date(today).getDay() + 6) % 7;
  return addDays(today, -sinceMonday - (ACTIVITY_WEEKS - 1) * 7);
}

/** The oldest moment any figure for this range looks at. */
export function activitySince(now: number, days: ActivityRange): number {
  return Math.min(heatmapStartOf(now), addDays(startOfDay(now), -(2 * days - 1)));
}

function totals({ words, takes, ms }: Omit<ActivityTotals, 'pace'>): ActivityTotals {
  return { words, takes, ms, pace: ms > MIN_PACE_MS ? Math.round(words / (ms / 60_000)) : 0 };
}

function streaks(times: readonly number[], today: number): Activity['streak'] {
  const days = new Set<number>();
  for (const time of times) {
    const day = startOfDay(time);
    if (day <= today) days.add(day);
  }
  let longest = 0;
  let run = 0;
  let last: number | null = null;
  for (const day of [...days].sort((a, b) => a - b)) {
    run = last !== null && addDays(last, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    last = day;
  }
  // A streak is still alive until a whole day passes without a transcript.
  let current = 0;
  for (let day = days.has(today) ? today : addDays(today, -1); days.has(day); day = addDays(day, -1)) current++;
  return { current, longest };
}

/**
 * `rows` are the transcripts since `activitySince(now, days)`; `times` are the creation times
 * of every transcript of the kind, for the longest streak.
 */
export function activityOf(rows: readonly ActivityRow[], times: readonly number[], { now = Date.now(), days }: { now?: number; days: ActivityRange }): Activity {
  const today = startOfDay(now);
  const rangeStart = addDays(today, -(days - 1));
  const previousStart = addDays(rangeStart, -days);
  const mapStart = heatmapStartOf(now);
  const daily = Array<number>(days).fill(0);
  const heatmap = Array<number>(ACTIVITY_WEEKS * 7).fill(0);
  const current = { words: 0, takes: 0, ms: 0 };
  const previous = { words: 0, takes: 0, ms: 0 };
  const models = new Map<string, ActivityModel>();

  for (const row of rows) {
    if (startOfDay(row.createdAt) > today) continue;
    const words = wordCount(row.text);
    const cell = dayIndex(mapStart, row.createdAt);
    if (cell >= 0 && cell < heatmap.length) heatmap[cell] = (heatmap[cell] ?? 0) + words;
    const bucket = row.createdAt >= rangeStart ? current : row.createdAt >= previousStart ? previous : null;
    if (!bucket) continue;
    bucket.words += words;
    bucket.takes += 1;
    bucket.ms += row.durationMs;
    if (bucket === current) {
      const day = dayIndex(rangeStart, row.createdAt);
      daily[day] = (daily[day] ?? 0) + words;
      const id = row.modelId || 'unknown';
      let model = models.get(id);
      if (!model) {
        model = { id, words: 0, takes: 0, ms: 0, inferenceMs: 0, dailyWords: Array<number>(days).fill(0), dailyMs: Array<number>(days).fill(0) };
        models.set(id, model);
      }
      model.words += words;
      model.takes += 1;
      model.ms += row.durationMs;
      model.inferenceMs += row.inferenceMs ?? 0;
      model.dailyWords[day] = (model.dailyWords[day] ?? 0) + words;
      model.dailyMs[day] = (model.dailyMs[day] ?? 0) + row.durationMs;
    }
  }

  const byUse = [...models.values()].sort((a, b) => b.words - a.words || b.ms - a.ms || a.id.localeCompare(b.id));
  return { ...totals(current), days, previous: totals(previous), daily, models: byUse, heatmap, heatmapStart: mapStart, today, streak: streaks(times, today) };
}
