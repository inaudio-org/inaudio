import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { transcriptTitle, wordCount, type Transcript } from '@shared/domain/history';
import { IconButton } from '@renderer/components/ui/icon-button';
import { ReadAloudButton, useReadingState } from '@renderer/features/read-aloud/read-aloud-controls';
import { api } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { formatDuration, formatTime } from '@renderer/lib/format';
import { useAction } from '@renderer/lib/use-action';

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

const WAVE_BARS = 64;

/**
 * The last few seconds of input as a wide, scrolling waveform: still and faint while idle,
 * frozen and dimmed while busy. The caller passes the level from a component that alone
 * subscribes to it, since it changes many times a second.
 */
export function LevelWave({ level, active, busy = false }: { level: number; active: boolean; busy?: boolean }) {
  const latest = useRef(level);
  latest.current = level;
  const [history, setHistory] = useState<number[]>(() => Array(WAVE_BARS).fill(0));

  useEffect(() => {
    if (!active) {
      if (!busy) setHistory(Array(WAVE_BARS).fill(0));
      return;
    }
    const id = setInterval(() => setHistory((h) => [...h.slice(1), latest.current]), 60);
    return () => clearInterval(id);
  }, [active, busy]);

  return (
    <div aria-hidden className="flex h-[72px] w-full items-center justify-between gap-[2px] rounded-[6px] bg-sunken px-4">
      {history.map((value, index) => (
        <span
          key={index}
          className={cn('w-1 shrink-0 rounded-full transition-[height] duration-75', active ? 'bg-accent' : busy ? 'bg-accent/40' : 'bg-line-strong')}
          style={{ height: `${Math.max(4, Math.min(52, Math.sqrt(value) * 66))}px` }}
        />
      ))}
    </div>
  );
}

/** Copies a transcript: a spinner while main writes the clipboard, a toast when it is done or fails. */
export function CopyButton({ text, label = 'Copy transcript' }: { text: string; label?: string }) {
  const copy = useAction(() => api.text.copy(text), { success: 'Copied to the clipboard' });
  return (
    <IconButton label={label} size="icon-sm" loading={copy.pending} disabled={!text} onClick={() => void copy.run()}>
      <Copy />
    </IconButton>
  );
}

/**
 * One recent transcript: its words, when, and Read aloud and Copy within reach. `fresh` marks
 * the one just made; `clamp` shortens long text to a few lines.
 */
export function RecentItem({
  item,
  fresh = false,
  detail,
  clamp = false,
  onOpen,
}: {
  item: Transcript;
  fresh?: boolean;
  /** Extra words for the details line, such as the time taken on device. */
  detail?: string;
  clamp?: boolean;
  onOpen?(): void;
}) {
  const reading = useReadingState(item.id);
  const words = wordCount(item.text);
  const body = (
    <>
      {clamp && item.title && <span className="block truncate text-[15px] font-semibold">{item.title}</span>}
      <span data-selectable className={cn('block text-[15px] leading-relaxed whitespace-pre-wrap break-words', clamp && 'line-clamp-2')}>
        {item.text}
      </span>
      <span className="block pt-1 text-xs text-faint tabular-nums">
        {fresh ? 'Just now' : formatTime(item.createdAt)} · {formatDuration(item.durationMs)} · {plural(words, 'word', 'words')}
        {detail ? ` · ${detail}` : ''}
      </span>
    </>
  );
  return (
    <li
      className={cn(
        'group flex items-start gap-3 rounded-[6px] px-3.5 py-3 transition-colors hover:bg-sunken',
        (fresh || reading !== 'idle') && 'bg-accent-soft hover:bg-accent-soft',
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 rounded-[6px] text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      <span
        className={cn(
          'flex shrink-0 items-center gap-1',
          !fresh && reading === 'idle' && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-busy]]:opacity-100',
        )}
      >
        <ReadAloudButton id={item.id} title={transcriptTitle(item)} text={item.text} />
        <CopyButton text={item.text} />
      </span>
    </li>
  );
}
