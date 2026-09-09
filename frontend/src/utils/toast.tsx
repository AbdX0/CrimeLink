import toast, { Toast } from 'react-hot-toast';

export type PushSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO' | 'SUCCESS';

export interface PushNotificationOptions {
  title: string;
  message: string;
  severity?: PushSeverity;
  timestamp?: string;
  link?: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
  playSound?: boolean;
}

// Synthesized subtle notification sound using Web Audio API
export function playNotificationTone(severity: PushSeverity = 'INFO') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (severity === 'CRITICAL') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(740, now + 0.08);
      osc.frequency.setValueAtTime(980, now + 0.16);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      osc.start(now);
      osc.stop(now + 0.32);
    } else if (severity === 'HIGH') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(700, now);
      osc.frequency.setValueAtTime(850, now + 0.09);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.24);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.07);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch {
    // AudioContext might be restricted until user gesture; ignore safely
  }
}

const severityConfig: Record<
  PushSeverity,
  {
    badgeBg: string;
    badgeText: string;
    borderColor: string;
    glowColor: string;
    icon: string;
  }
> = {
  CRITICAL: {
    badgeBg: 'bg-red-500/20 text-red-400 border border-red-500/40',
    badgeText: 'CRITICAL ALERT',
    borderColor: 'border-red-500/50',
    glowColor: 'shadow-red-950/40',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  HIGH: {
    badgeBg: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
    badgeText: 'HIGH RISK',
    borderColor: 'border-amber-500/40',
    glowColor: 'shadow-amber-950/30',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  MEDIUM: {
    badgeBg: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',
    badgeText: 'ANALYSIS',
    borderColor: 'border-blue-500/30',
    glowColor: 'shadow-blue-950/20',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  INFO: {
    badgeBg: 'bg-zinc-700/50 text-zinc-300 border border-zinc-600/40',
    badgeText: 'SYSTEM',
    borderColor: 'border-zinc-700',
    glowColor: 'shadow-zinc-950/20',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  SUCCESS: {
    badgeBg: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
    badgeText: 'SUCCESS',
    borderColor: 'border-emerald-500/40',
    glowColor: 'shadow-emerald-950/20',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
};

/**
 * Renders an enterprise Push Notification card via react-hot-toast
 */
export function showPushNotification(options: PushNotificationOptions) {
  const {
    title,
    message,
    severity = 'INFO',
    timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    link,
    actionLabel,
    onAction,
    duration = 5500,
    playSound = true,
  } = options;

  if (playSound) {
    playNotificationTone(severity);
  }

  const conf = severityConfig[severity] || severityConfig.INFO;

  return toast.custom(
    (t: Toast) => (
      <div
        className={`${
          t.visible ? 'animate-in fade-in slide-in-from-top-4 duration-200' : 'animate-out fade-out slide-out-to-top-2 duration-150'
        } max-w-sm sm:max-w-md w-full bg-[#121215] border ${conf.borderColor} shadow-2xl ${conf.glowColor} rounded-lg pointer-events-auto overflow-hidden font-sans`}
        style={{
          boxShadow: '0 20px 30px -10px rgba(0, 0, 0, 0.7), 0 0 15px -3px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Top bar with alert type, sound icon, time, and dismiss */}
        <div className="flex items-center justify-between px-3.5 py-2 bg-[#18181c] border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  severity === 'CRITICAL'
                    ? 'bg-red-400'
                    : severity === 'HIGH'
                    ? 'bg-amber-400'
                    : severity === 'SUCCESS'
                    ? 'bg-emerald-400'
                    : 'bg-blue-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  severity === 'CRITICAL'
                    ? 'bg-red-500'
                    : severity === 'HIGH'
                    ? 'bg-amber-500'
                    : severity === 'SUCCESS'
                    ? 'bg-emerald-500'
                    : 'bg-blue-500'
                }`}
              />
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase tracking-wider ${conf.badgeBg}`}>
              {conf.badgeText}
            </span>
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
              CrimeLink Push
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-500">{timestamp}</span>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="text-zinc-400 hover:text-white p-0.5 rounded transition-colors"
              aria-label="Close notification"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-3.5 flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <svg
              className={`w-5 h-5 ${
                severity === 'CRITICAL'
                  ? 'text-red-400'
                  : severity === 'HIGH'
                  ? 'text-amber-400'
                  : severity === 'SUCCESS'
                  ? 'text-emerald-400'
                  : 'text-blue-400'
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={conf.icon} />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold text-white tracking-tight leading-snug">
              {title}
            </h4>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              {message}
            </p>

            {/* Actions */}
            {(link || onAction || actionLabel) && (
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-800/60">
                {link ? (
                  <a
                    href={link}
                    onClick={() => toast.dismiss(t.id)}
                    className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <span>{actionLabel || 'Investigate in Network'}</span>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                ) : (
                  <button
                    onClick={() => {
                      if (onAction) onAction();
                      toast.dismiss(t.id);
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    <span>{actionLabel || 'View Details'}</span>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}

                <button
                  onClick={() => toast.dismiss(t.id)}
                  className="ml-auto text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    { duration }
  );
}

/**
 * Standard toasts with CrimeLink theme
 */
export const showToast = {
  success: (msg: string, details?: string) => {
    if (details) {
      return showPushNotification({
        title: msg,
        message: details,
        severity: 'SUCCESS',
        duration: 3500,
        playSound: false,
      });
    }
    return toast.success(msg, {
      duration: 3000,
    });
  },

  error: (msg: string, details?: string) => {
    if (details) {
      return showPushNotification({
        title: msg,
        message: details,
        severity: 'CRITICAL',
        duration: 5000,
        playSound: true,
      });
    }
    return toast.error(msg, {
      duration: 4000,
    });
  },

  info: (msg: string, details?: string) => {
    if (details) {
      return showPushNotification({
        title: msg,
        message: details,
        severity: 'INFO',
        duration: 3500,
        playSound: false,
      });
    }
    return toast(msg, {
      icon: 'ℹ️',
      duration: 3000,
    });
  },

  warning: (msg: string, details?: string) => {
    if (details) {
      return showPushNotification({
        title: msg,
        message: details,
        severity: 'HIGH',
        duration: 4500,
        playSound: true,
      });
    }
    return toast(msg, {
      icon: '⚠️',
      duration: 3500,
    });
  },

  loading: (msg: string) => {
    return toast.loading(msg);
  },

  dismiss: (id?: string) => {
    toast.dismiss(id);
  },

  push: showPushNotification,
};

export default toast;
