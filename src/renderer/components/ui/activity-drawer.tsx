import { ArrowDownRight, ArrowUpRight, ChartColumn, Minus } from 'lucide-react';
import { useId, useState, type PointerEvent, type ReactNode } from 'react';
import { MODEL_CATALOG, type ModelId } from '@shared/domain/models';
import { ACTIVITY_WEEKS, addDays, type Activity, type ActivityKind, type ActivityModel, type ActivityRange } from '@shared/history/stats';
import { Button } from '@renderer/components/ui/button';
import { Drawer } from '@renderer/components/ui/drawer';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { IconButton } from '@renderer/components/ui/icon-button';
import { Notice } from '@renderer/components/ui/layout';
import { Segmented } from '@renderer/components/ui/segmented';
import { Tooltip } from '@renderer/components/ui/tooltip';
import { cn } from '@renderer/lib/cn';
import { formatSpan } from '@renderer/lib/format';
import { useHistoryStats } from '@renderer/lib/queries';
import { useUi } from '@renderer/stores/ui-store';

const RANGES: { value: `${ActivityRange}`; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
];
const narrowDay = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const minutesOf = (ms: number) => Math.round(ms / 60_000);

/** Speech models in catalog order, so each keeps its colour whichever is used most. */
const STT_ORDER = (Object.keys(MODEL_CATALOG) as ModelId[]).filter((id) => MODEL_CATALOG[id].kind === 'stt');
const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];

function modelColor(id: string): string {
  const index = STT_ORDER.indexOf(id as ModelId);
  return index < 0 ? 'var(--chart-4)' : (SERIES[index % SERIES.length] ?? 'var(--chart-4)');
}

function modelName(id: string): string {
  return id in MODEL_CATALOG ? MODEL_CATALOG[id as ModelId].name : id === 'unknown' ? 'Unknown model' : 'Removed model';
}

/** 1, 2, 2.5 or 5 times a power of ten: an axis top that reads cleanly. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

/** One number in the grid: label, value with its unit, and a quiet line under it. */
function Metric({ label, value, unit, note, className }: { label: string; value: string; unit?: string; note?: ReactNode; className?: string }) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1', className)}>
      <span className="text-xs text-muted">{label}</span>
      <span className="truncate text-[26px] leading-tight font-semibold tracking-tight tabular-nums">
        {value}
        {unit && <span className="ml-1.5 text-[13px] font-medium tracking-normal text-muted">{unit}</span>}
      </span>
      <span className="flex min-h-[18px] items-center gap-1 text-xs text-muted">{note}</span>
    </div>
  );
}

/** How a figure compares with the period before. The words carry the direction; the arrow repeats it. */
function Change({ now, before, days }: { now: number; before: number; days: number }) {
  if (!now && !before) return null;
  if (!before) return <span>Nothing in the previous {days} days</span>;
  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) {
    return (
      <>
        <Minus aria-hidden className="size-3.5 shrink-0" />
        <span>Same as the previous {days} days</span>
      </>
    );
  }
  const Arrow = percent > 0 ? ArrowUpRight : ArrowDownRight;
  const amount = `${Math.abs(percent).toLocaleString()}% ${percent > 0 ? 'more' : 'less'}`;
  return (
    <span title={`${amount} than the previous ${days} days`} className="flex min-w-0 items-center gap-1">
      <Arrow aria-hidden className={cn('size-3.5 shrink-0', percent > 0 ? 'text-success' : 'text-danger')} />
      <span className="shrink-0 text-ink">{amount}</span>
      <span className="truncate">than the previous {days} days</span>
    </span>
  );
}

/** A monotone cubic through the points, so the curve never overshoots a day's value. */
function monotonePath(points: [number, number][]): string {
  const n = points.length;
  const first = points[0];
  if (!first) return '';
  if (n === 1) return `M${first[0]},${first[1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i] as [number, number];
    const [x1, y1] = points[i + 1] as [number, number];
    dx.push(x1 - x0);
    slope.push((y1 - y0) / (x1 - x0));
  }
  const tangent: number[] = [slope[0] ?? 0];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1] ?? 0;
    const b = slope[i] ?? 0;
    const da = dx[i - 1] ?? 1;
    const db = dx[i] ?? 1;
    tangent.push(a * b <= 0 ? 0 : (3 * (da + db)) / ((2 * db + da) / a + (db + 2 * da) / b));
  }
  tangent.push(slope[n - 2] ?? 0);
  let d = `M${first[0].toFixed(1)},${first[1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i] as [number, number];
    const [x1, y1] = points[i + 1] as [number, number];
    const h = (dx[i] ?? 0) / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + h * (tangent[i] ?? 0)).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - h * (tangent[i + 1] ?? 0)).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

const CHART_W = 520;
const CHART_H = 168;

interface Series {
  id: string;
  name: string;
  color: string;
  values: number[];
}

/**
 * Per-day amounts stacked by model: a smooth area for dictation's words, columns for live
 * minutes, since sessions come in bursts. Hovering or focusing a day shows each model's part.
 */
function StackedChart({
  series,
  today,
  shape,
  format,
  label,
}: {
  series: Series[];
  today: number;
  shape: 'area' | 'columns';
  format(value: number): string;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const count = series[0]?.values.length ?? 0;
  const totals = Array.from({ length: count }, (_, day) => series.reduce((sum, item) => sum + (item.values[day] ?? 0), 0));
  const max = niceCeil(Math.max(...totals, 1));
  const dates = totals.map((_, index) => addDays(today, index - (count - 1)));
  const x = (day: number) => (count === 1 ? CHART_W / 2 : (day * CHART_W) / (count - 1));
  const y = (value: number) => CHART_H - (value / max) * CHART_H;

  const layers: { item: Series; area: string; line: string; base: number[]; top: number[] }[] = [];
  let base = Array<number>(count).fill(0);
  for (const item of series) {
    const top = base.map((value, day) => value + (item.values[day] ?? 0));
    const upper = monotonePath(top.map((value, day) => [x(day), y(value)]));
    const lower = monotonePath(base.map((value, day) => [x(day), y(value)] as [number, number]).reverse());
    layers.push({ item, area: `${upper}L${lower.slice(1)}Z`, line: upper, base, top });
    base = top;
  }

  const xLabel = (index: number) => {
    if (index === count - 1) return 'Today';
    if (count <= 7) return narrowDay.format(dates[index]);
    return (count - 1 - index) % 7 === 0 ? shortDate.format(dates[index]) : '';
  };
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover(shape === 'area' ? Math.round(share * (count - 1)) : Math.min(count - 1, Math.floor(share * count)));
  };
  const hoverLeft = hover === null ? 0 : shape === 'area' ? (x(hover) / CHART_W) * 100 : ((hover + 0.5) / count) * 100;

  return (
    <div className="grid gap-2">
      <div
        className="relative h-[168px] touch-none outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        role="group"
        aria-label={`${label}. Use the left and right arrow keys to read each day.`}
        tabIndex={0}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setHover((current) => Math.min(count - 1, Math.max(0, (current ?? count - 1) + (event.key === 'ArrowLeft' ? -1 : 1))));
        }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[max, max / 2].map((tick) => (
            <div key={tick} className="h-0 border-t border-dashed border-line">
              <span className="relative -top-2 bg-surface pr-1.5 text-[11px] text-faint tabular-nums">{format(tick)}</span>
            </div>
          ))}
          <div className="h-0 border-t border-line-strong" />
        </div>

        {shape === 'area' ? (
          <svg aria-hidden viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {layers.map(({ item, area }) => (
              <path key={`area-${item.id}`} d={area} fill={item.color} fillOpacity={0.88} />
            ))}
            {layers.map(({ item, line }) => (
              <path key={`line-${item.id}`} d={line} fill="none" stroke={item.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        ) : (
          <div aria-hidden className="absolute inset-0 flex items-end gap-[3px]">
            {totals.map((total, day) => (
              <div key={dates[day]} className={cn('flex h-full flex-1 flex-col-reverse gap-px transition-opacity', hover !== null && hover !== day && 'opacity-60')}>
                {series.map((item, index) => {
                  const value = item.values[day] ?? 0;
                  if (!value) return null;
                  const last = series.slice(index + 1).every((next) => !(next.values[day] ?? 0));
                  return (
                    <span
                      key={item.id}
                      className={cn('block shrink-0', last && 'rounded-t-[2px]')}
                      style={{ height: `${(value / max) * 100}%`, background: item.color }}
                    />
                  );
                })}
                {!total && <span className="block h-px bg-line" />}
              </div>
            ))}
          </div>
        )}

        {hover !== null && (
          <>
            {shape === 'area' && (
              <>
                <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-ink/30" style={{ left: `${hoverLeft}%` }} />
                <span
                  aria-hidden
                  className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface"
                  style={{ left: `${hoverLeft}%`, top: `${(y(totals[hover] ?? 0) / CHART_H) * 100}%`, borderColor: layers[layers.length - 1]?.item.color }}
                />
              </>
            )}
            <div
              role="status"
              className="pointer-events-none absolute top-1.5 z-10 flex w-[228px] flex-col gap-1.5 overflow-hidden rounded-[6px] bg-surface px-3 py-2.5 text-xs shadow-[0_0_0_1px_var(--line),0_8px_20px_rgb(0_0_0/0.1)]"
              style={hoverLeft > 50 ? { right: `calc(${100 - hoverLeft}% + 12px)` } : { left: `calc(${hoverLeft}% + 12px)` }}
            >
              <span className="flex min-w-0 justify-between gap-2 font-semibold">
                <span>{hover === count - 1 ? 'Today' : longDate.format(dates[hover])}</span>
                <span className="tabular-nums">{format(totals[hover] ?? 0)}</span>
              </span>
              {series.map((item) => (
                <span key={item.id} className="flex min-w-0 items-center gap-1.5 text-muted">
                  <i aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-ink tabular-nums">{format(item.values[hover] ?? 0)}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div aria-hidden className="grid text-[11px] text-faint" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {dates.map((date, index) => (
          <span key={date} className={cn('text-center whitespace-nowrap', index === count - 1 && 'font-semibold text-accent')}>
            {xLabel(index)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {series.map((item) => (
              <th key={item.id} scope="col">
                {item.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((date, day) => (
            <tr key={date}>
              <th scope="row">{day === count - 1 ? 'Today' : longDate.format(date)}</th>
              {series.map((item) => (
                <td key={item.id}>{format(item.values[day] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each model's share of the range, with how fast it ran on this computer. */
function ModelTable({ models, kind }: { models: ActivityModel[]; kind: ActivityKind }) {
  const amount = (model: ActivityModel) => (kind === 'live' ? model.ms : model.words);
  const total = models.reduce((sum, model) => sum + amount(model), 0) || 1;
  return (
    <div className="grid gap-3">
      <div aria-hidden className="flex h-2 gap-0.5">
        {models.map((model) => (
          <span key={model.id} className="block rounded-[2px]" style={{ width: `${(amount(model) / total) * 100}%`, background: modelColor(model.id) }} />
        ))}
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sr-only">
          <tr>
            <th scope="col">Model</th>
            <th scope="col">{kind === 'live' ? 'Time' : 'Words'}</th>
            <th scope="col">Share</th>
            <th scope="col">Speed</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const span = formatSpan(model.ms);
            const speed = model.inferenceMs > 0 ? model.ms / model.inferenceMs : 0;
            return (
              <tr key={model.id}>
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <i aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: modelColor(model.id) }} />
                    <span className="truncate">{modelName(model.id)}</span>
                  </span>
                </th>
                <td className="py-1.5 pl-2 text-right whitespace-nowrap tabular-nums">
                  {kind === 'live' ? `${span.value} ${span.unit}` : plural(model.words, 'word', 'words')}
                </td>
                <td className="w-12 py-1.5 pl-2 text-right text-muted tabular-nums">{Math.round((amount(model) / total) * 100)}%</td>
                <td className="w-28 py-1.5 pl-2 text-right whitespace-nowrap text-muted tabular-nums" title="Length of the audio divided by the time it took on this computer">
                  {speed >= 1 ? `${Math.round(speed).toLocaleString()}× real time` : speed > 0 ? `${speed.toFixed(1)}× real time` : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const HEAT = ['bg-sunken shadow-[inset_0_0_0_1px_var(--line)]', 'bg-accent-soft', 'bg-accent/45', 'bg-accent/70', 'bg-accent'];

const monthName = new Intl.DateTimeFormat(undefined, { month: 'short' });
/** Row labels down the left of the heatmap, Monday first; blank rows keep it quiet. */
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
/** The label column, shared by the month row and the grid so both line up. */
const LABEL_COLUMN = '28px';

/**
 * Half a year of words across the drawer's full width: one column a week, Monday to Sunday
 * down each column, ending with this week. Cells stay square and grow with the drawer.
 */
function Heatmap({ activity }: { activity: Activity }) {
  const { heatmap, heatmapStart, today, streak } = activity;
  const max = Math.max(1, ...heatmap);
  const level = (words: number) => (words ? Math.min(4, Math.ceil((words / max) * 4)) : 0);
  const weeks = Array.from({ length: ACTIVITY_WEEKS }, (_, week) => addDays(heatmapStart, week * 7));
  const columns = { gridTemplateColumns: `${LABEL_COLUMN} repeat(${ACTIVITY_WEEKS}, minmax(0, 1fr))` };
  // A month is named over the first week that starts in it, unless the next name would
  // follow within two columns and the two would run into each other.
  const starts = weeks.map((week, index) => index === 0 || new Date(week).getMonth() !== new Date(weeks[index - 1] ?? 0).getMonth());
  const monthOf = (week: number) => {
    if (!starts[week]) return '';
    if (starts[week + 1] || starts[week + 2]) return '';
    return monthName.format(new Date(weeks[week] ?? 0));
  };
  const summary = `Words per day for the last ${ACTIVITY_WEEKS} weeks. Current streak ${plural(streak.current, 'day', 'days')}, longest ${plural(streak.longest, 'day', 'days')}.`;
  return (
    <div className="grid gap-2">
      <div aria-hidden className="grid gap-x-[3px] text-[11px] text-faint" style={columns}>
        <span />
        {weeks.map((week, index) => (
          <span key={week} className="min-w-0 overflow-visible whitespace-nowrap">
            {monthOf(index)}
          </span>
        ))}
      </div>
      <div role="img" aria-label={summary} className="grid grid-flow-col grid-rows-7 gap-[3px]" style={columns}>
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={`label-${index}`} aria-hidden className="flex items-center text-[10px] leading-none text-faint">
            {label}
          </span>
        ))}
        {heatmap.map((words, index) => {
          const day = addDays(heatmapStart, index);
          if (day > today) return <i key={day} aria-hidden className="invisible aspect-square" />;
          return (
            <Tooltip key={day} content={`${longDate.format(day)} · ${plural(words, 'word', 'words')}`}>
              <i
                aria-hidden
                className={cn('block aspect-square min-w-0 rounded-[2px]', HEAT[level(words)], day === today && 'outline outline-1 outline-offset-1 outline-accent')}
              />
            </Tooltip>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 pt-1 text-xs text-muted" style={{ paddingLeft: LABEL_COLUMN }}>
        <span>
          Current streak <span className="font-semibold text-ink tabular-nums">{plural(streak.current, 'day', 'days')}</span>
          {streak.longest ? (
            <>
              {' · '}Longest <span className="font-semibold text-ink tabular-nums">{plural(streak.longest, 'day', 'days')}</span>
            </>
          ) : null}
        </span>
        <span aria-hidden className="inline-flex items-center gap-[3px] text-[11px] text-faint">
          Less
          {HEAT.map((tone) => (
            <i key={tone} className={cn('inline-block size-2.5 rounded-[2px]', tone)} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

function DrawerSection({ title, note, children, last = false }: { title: string; note?: string; children: ReactNode; last?: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('grid gap-3', !last && 'border-b border-line pb-5')}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="m-0 text-sm font-semibold">
          {title}
        </h3>
        {note && <span className="text-xs text-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function ActivitySkeleton() {
  return (
    <div aria-hidden className="grid gap-5">
      <div className="grid grid-cols-2 gap-y-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="grid gap-2.5 pr-5">
            <span className="skeleton h-3 w-16 rounded-[6px]" />
            <span className="skeleton h-7 w-24 rounded-[6px]" />
            <span className="skeleton h-3 w-32 rounded-[6px]" />
          </div>
        ))}
      </div>
      <span className="skeleton h-[168px] rounded-[6px]" />
    </div>
  );
}

const KIND_COPY: Record<ActivityKind, { title: string; description: string; takes: string; empty: (days: number) => { title: string; description: string } }> = {
  dictation: {
    title: 'Dictation activity',
    description: 'Counted on this computer from your saved dictations.',
    takes: 'Dictations',
    empty: (days) => ({ title: `No dictations in the last ${days} days`, description: 'Dictate in any app and each take is counted here.' }),
  },
  live: {
    title: 'Live activity',
    description: 'Counted on this computer from your saved live sessions.',
    takes: 'Sessions',
    empty: (days) => ({ title: `No live sessions in the last ${days} days`, description: 'Stop a live transcript and its words are counted here.' }),
  },
};

/** The page-header icon that opens the activity drawer. */
export function ActivityButton({ open, onClick }: { open: boolean; onClick(): void }) {
  return (
    <IconButton label="Activity" side="bottom" aria-expanded={open} aria-haspopup="dialog" onClick={onClick}>
      <ChartColumn />
    </IconButton>
  );
}

/**
 * The page's activity in a side drawer, counted in the main process from saved transcripts:
 * four figures with their change from the period before, each day split by recognition model,
 * each model's share and speed, and half a year of streaks. Nothing is counted until it opens.
 */
export function ActivityDrawer({ kind, open, onOpenChange }: { kind: ActivityKind; open: boolean; onOpenChange(open: boolean): void }) {
  const [days, setDays] = useState<ActivityRange>(7);
  const { data, isError, refetch, isFetching } = useHistoryStats(kind, days, open);
  const navigate = useUi((s) => s.navigate);
  const copy = KIND_COPY[kind];
  const span = data?.ms ? formatSpan(data.ms) : undefined;
  const series: Series[] = (data?.models ?? []).map((model) => ({
    id: model.id,
    name: modelName(model.id),
    color: modelColor(model.id),
    values: kind === 'live' ? model.dailyMs.map(minutesOf) : model.dailyWords,
  }));
  const first = data ? addDays(data.today, -(days - 1)) : 0;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      className="w-[min(560px,calc(100vw-12px))]"
      footer={
        <>
          <span className="flex-1 text-xs text-faint">
            {data ? `${plural(data.takes, kind === 'live' ? 'session' : 'dictation', kind === 'live' ? 'sessions' : 'dictations')} · nothing leaves this computer` : ''}
          </span>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              navigate('history');
            }}
          >
            Open History
          </Button>
        </>
      }
    >
      <div aria-busy={isFetching || undefined} className="grid gap-5 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <Segmented<`${ActivityRange}`> label="Activity range" value={`${days}`} onValueChange={(next) => setDays(Number(next) as ActivityRange)} options={RANGES} />
          {data && <span className="text-xs text-faint">{`${shortDate.format(first)} – ${shortDate.format(data.today)}`}</span>}
        </div>
        {isError && !data ? (
          <Notice
            tone="danger"
            action={
              <Button size="sm" loading={isFetching} onClick={() => void refetch()}>
                Try again
              </Button>
            }
          >
            Activity could not be counted.
          </Notice>
        ) : !data ? (
          <ActivitySkeleton />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-y-4 border-b border-line pb-5">
              <Metric className="pr-5" label="Words" value={data.words.toLocaleString()} note={<Change now={data.words} before={data.previous.words} days={days} />} />
              <Metric className="border-l border-line pl-5" label={copy.takes} value={data.takes.toLocaleString()} note={<Change now={data.takes} before={data.previous.takes} days={days} />} />
              {kind === 'dictation' ? (
                <Metric
                  className="pr-5"
                  label="Pace"
                  value={data.pace ? data.pace.toLocaleString() : '–'}
                  unit={data.pace ? 'words a minute' : undefined}
                  note={data.pace && data.previous.pace ? <Change now={data.pace} before={data.previous.pace} days={days} /> : null}
                />
              ) : (
                <Metric className="pr-5" label="Time transcribed" value={span?.value ?? '–'} unit={span?.unit} note={<Change now={data.ms} before={data.previous.ms} days={days} />} />
              )}
              <Metric
                className="border-l border-line pl-5"
                label="Streak"
                value={data.streak.current.toLocaleString()}
                unit={data.streak.current === 1 ? 'day' : 'days'}
                note={data.streak.longest ? `Longest ${plural(data.streak.longest, 'day', 'days')}` : null}
              />
            </div>
            {data.takes ? (
              <>
                <DrawerSection title={kind === 'live' ? 'Minutes by model' : 'Words by model'} note="Stacked · per day">
                  <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
                    {series.map((item) => (
                      <span key={item.id} className="inline-flex items-center gap-1.5 text-xs text-muted">
                        <i aria-hidden className="size-2.5 rounded-[2px]" style={{ background: item.color }} />
                        {item.name}
                      </span>
                    ))}
                  </div>
                  <StackedChart
                    series={series}
                    today={data.today}
                    shape={kind === 'live' ? 'columns' : 'area'}
                    format={kind === 'live' ? (value) => `${Math.round(value).toLocaleString()} min` : (value) => Math.round(value).toLocaleString()}
                    label={kind === 'live' ? `Minutes transcribed per day for the last ${days} days, by model` : `Words per day for the last ${days} days, by model`}
                  />
                </DrawerSection>
                <DrawerSection title="Models" note="Speed is audio length ÷ time on device">
                  <ModelTable models={data.models} kind={kind} />
                </DrawerSection>
              </>
            ) : (
              <div className="border-b border-line pb-5">
                <EmptyState size="sm" {...copy.empty(days)} />
              </div>
            )}
            <DrawerSection title="Streaks" note={`Last ${ACTIVITY_WEEKS} weeks`} last>
              <Heatmap activity={data} />
            </DrawerSection>
          </>
        )}
      </div>
    </Drawer>
  );
}
