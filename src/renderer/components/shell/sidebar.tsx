import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Wordmark } from '@renderer/components/brand/logo';
import {
  AudioLinesMotion,
  BoxesMotion,
  CaptionsMotion,
  HistoryMotion,
  MicMotion,
  PanelLeftCloseMotion,
  PanelLeftOpenMotion,
  Settings2Motion,
  SparklesMotion,
  Volume2Motion,
  type MotionIcon,
  type MotionIconHandle,
} from '@renderer/components/icons/motion-icons';
import { IconButton } from '@renderer/components/ui/icon-button';
import { Tooltip } from '@renderer/components/ui/tooltip';
import { Waveform } from '@renderer/components/ui/waveform';
import { useLive } from '@renderer/features/live/live-store';
import { useReadAloud } from '@renderer/features/read-aloud/read-aloud-store';
import { cn } from '@renderer/lib/cn';
import { formatAccelerator } from '@renderer/lib/format';
import { useSettings, useSystemStatus, useUpdateSettings } from '@renderer/lib/queries';
import { useDictation } from '@renderer/stores/dictation-store';
import { useUi, type Route } from '@renderer/stores/ui-store';
import { EngineStatus } from './engine-status';

type NavItem = { route: Route; label: string; icon: MotionIcon };

/** The app's pages in groups, the same way Settings lists its categories. */
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Speak',
    items: [
      { route: 'dictation', label: 'Dictation', icon: MicMotion },
      { route: 'live', label: 'Live transcript', icon: CaptionsMotion },
      { route: 'read-aloud', label: 'Read Aloud', icon: Volume2Motion },
    ],
  },
  { label: 'Library', items: [{ route: 'history', label: 'History', icon: HistoryMotion }] },
  {
    label: 'Engine',
    items: [
      { route: 'models', label: 'Models', icon: BoxesMotion },
      { route: 'audio', label: 'Audio', icon: AudioLinesMotion },
      { route: 'companion', label: 'Companion', icon: SparklesMotion },
    ],
  },
];

/** What is happening on a page right now, drawn as a small waveform. */
type Activity = 'listening' | 'capturing' | 'reading';
const ACTIVITY_LABEL: Record<Activity, string> = {
  listening: 'Listening',
  capturing: 'Recording system audio',
  reading: 'Reading aloud',
};

/** The dictation and live markers follow their input level; reading keeps an even rhythm. */
function ActivityWave({ activity, compact }: { activity: Activity; compact: boolean }) {
  const dictationLevel = useDictation((s) => (activity === 'listening' ? s.level : 0));
  const liveLevel = useLive((s) => (activity === 'capturing' ? s.level : 0));
  const level = activity === 'listening' ? dictationLevel : activity === 'capturing' ? liveLevel : undefined;
  return (
    <Waveform
      level={level}
      bars={compact ? 3 : 4}
      label={ACTIVITY_LABEL[activity]}
      className={cn('text-accent', compact ? 'absolute top-1 right-1.5 h-2.5 gap-px' : 'ml-auto')}
      barClassName={compact ? 'w-[2px]' : 'w-[2.5px]'}
    />
  );
}

/** Plays a motion icon once when its page opens, not when the app first draws. */
function usePlayOnActive(icon: RefObject<MotionIconHandle | null>, active: boolean | undefined) {
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current && active) icon.current?.start();
    mounted.current = true;
  }, [active, icon]);
}

function NavButton({
  label,
  icon: Icon,
  active,
  collapsed,
  onClick,
  trailing,
  activity,
}: {
  label: string;
  icon: MotionIcon;
  active?: boolean;
  collapsed: boolean;
  onClick(): void;
  /** Quiet text on the right, such as a shortcut. Hidden when collapsed. */
  trailing?: ReactNode;
  /** Something running on that page, shown as a waveform. */
  activity?: Activity | null;
}) {
  const icon = useRef<MotionIconHandle>(null);
  usePlayOnActive(icon, active);
  const button = (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => icon.current?.start()}
      onFocus={(event) => event.currentTarget.matches(':focus-visible') && icon.current?.start()}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:bg-surface/60 hover:text-ink',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon ref={icon} className={cn('size-[17px] shrink-0', active && 'text-accent')} />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && trailing && !activity && <span className="ml-auto truncate pl-2 text-[11px] text-faint">{trailing}</span>}
      {activity && <ActivityWave activity={activity} compact={collapsed} />}
    </button>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/**
 * The app's navigation: pages in groups, then what is always within reach at the bottom:
 * the engine's state, Settings and the collapse control. What's new lives in the title bar.
 */
export function Sidebar({ macInset }: { macInset: boolean }) {
  const { route, navigate } = useUi();
  const { data: settings } = useSettings();
  const { data: status } = useSystemStatus();
  const update = useUpdateSettings();
  const phase = useDictation((s) => s.phase);
  const liveCapturing = useLive((s) => s.live.phase === 'capturing');
  const reading = useReadAloud((s) => s.state.status === 'playing' || s.state.status === 'preparing');
  const toggleIcon = useRef<MotionIconHandle>(null);
  const collapsed = settings?.appearance.sidebarCollapsed ?? false;
  const shortcut = settings && status ? formatAccelerator(settings.dictation.shortcut, status.platform).join(' ') : '';

  const toggle = () => update.mutate({ appearance: { sidebarCollapsed: !collapsed } });
  const activity = (target: Route): Activity | null =>
    target === 'dictation' && phase === 'listening'
      ? 'listening'
      : target === 'live' && liveCapturing
        ? 'capturing'
        : target === 'read-aloud' && reading
          ? 'reading'
          : null;

  return (
    <aside
      aria-label="Primary"
      className={cn('flex shrink-0 flex-col pb-3 transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-[240px]')}
    >
      <div className={cn('drag flex h-11 shrink-0 items-center', macInset ? 'pl-[84px]' : 'pl-4')} />
      <div className={cn('flex shrink-0 items-center px-4 pt-2 pb-3', collapsed ? 'justify-center px-0' : 'justify-between')}>
        <Wordmark collapsed={collapsed} />
      </div>

      <NavigationMenu.Root orientation="vertical" className="app-scroll-area min-h-0 flex-1 overflow-y-auto">
        <NavigationMenu.List className="grid gap-0.5 px-3">
          {GROUPS.map((group) => (
            <li key={group.label} className="contents">
              {collapsed ? (
                <span aria-hidden className="mx-auto my-2 block h-px w-6 bg-line first:hidden" />
              ) : (
                <span className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{group.label}</span>
              )}
              <ul className="m-0 grid list-none gap-0.5 p-0" aria-label={group.label}>
                {group.items.map((item) => (
                  <NavigationMenu.Item key={item.route}>
                    <NavigationMenu.Link asChild active={item.route === route}>
                      <NavButton
                        label={item.label}
                        icon={item.icon}
                        active={item.route === route}
                        collapsed={collapsed}
                        onClick={() => navigate(item.route)}
                        trailing={item.route === 'dictation' ? shortcut : undefined}
                        activity={activity(item.route)}
                      />
                    </NavigationMenu.Link>
                  </NavigationMenu.Item>
                ))}
              </ul>
            </li>
          ))}
        </NavigationMenu.List>
      </NavigationMenu.Root>

      <div className="grid shrink-0 gap-1 px-3 pt-2">
        <EngineStatus collapsed={collapsed} />
        <div className={cn('flex items-center gap-1 border-t border-line pt-1.5', collapsed && 'flex-col')}>
          <div className={cn(collapsed ? 'w-full' : 'flex-1')}>
            <NavButton label="Settings" icon={Settings2Motion} active={route === 'settings'} collapsed={collapsed} onClick={() => navigate('settings')} />
          </div>
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            side="right"
            onClick={toggle}
            onMouseEnter={() => toggleIcon.current?.start()}
          >
            {collapsed ? <PanelLeftOpenMotion ref={toggleIcon} /> : <PanelLeftCloseMotion ref={toggleIcon} />}
          </IconButton>
        </div>
      </div>
    </aside>
  );
}
