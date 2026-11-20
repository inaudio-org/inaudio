import { useRef } from 'react';
import { WandSparklesMotion, type MotionIconHandle } from '@renderer/components/icons/motion-icons';
import { Tooltip } from '@renderer/components/ui/tooltip';
import { useSettings, useSystemStatus } from '@renderer/lib/queries';
import { useUi } from '@renderer/stores/ui-store';

/**
 * What's new, beside the window controls. After an update it reads "What's new in x.y.z"
 * until the billboard has been opened for that version (`announcements.seenVersion`); from
 * then on only the icon stays, still opening it, until the next version arrives.
 */
export function WhatsNewButton() {
  const { data: settings } = useSettings();
  const { data: status } = useSystemStatus();
  const open = useUi((s) => s.setWhatsNew);
  const icon = useRef<MotionIconHandle>(null);
  const version = status?.appVersion;
  if (!settings || !version) return null;
  const unseen = settings.announcements.seenVersion !== version;

  if (unseen) {
    return (
      <button
        type="button"
        onClick={() => open(true)}
        onMouseEnter={() => icon.current?.start()}
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && icon.current?.start()}
        className="flex h-7 items-center gap-1.5 rounded-full bg-accent-soft pr-2.5 pl-2 text-xs font-semibold text-accent outline-none hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <WandSparklesMotion ref={icon} className="size-3.5" />
        What’s new in {version}
        <span className="sr-only">, not opened yet</span>
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      </button>
    );
  }

  return (
    <Tooltip content={`What’s new in ${version}`} side="bottom">
      <button
        type="button"
        aria-label={`What’s new in ${version}`}
        onClick={() => open(true)}
        onMouseEnter={() => icon.current?.start()}
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && icon.current?.start()}
        className="grid size-7 place-items-center rounded-[6px] text-muted outline-none hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <WandSparklesMotion ref={icon} className="size-4" />
      </button>
    </Tooltip>
  );
}
