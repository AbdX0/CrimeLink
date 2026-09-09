import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getSuspiciousPatterns } from '../api/client';
import { showPushNotification, showToast, PushSeverity } from '../utils/toast';

export interface InAppNotification {
  id: string;
  title: string;
  message: string;
  severity: PushSeverity;
  timestamp: string;
  read: boolean;
  link?: string;
  entityId?: string;
}

const STORAGE_KEY = 'crimelink_notifications_history';
const SETTINGS_KEY = 'crimelink_notification_settings';
const SEEN_ALERTS_KEY = 'crimelink_seen_alert_keys';

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [
      {
        id: 'init-sys',
        title: 'Push Notification System Active',
        message: 'Real-time background anomaly & intelligence alerts are enabled via react-hot-toast.',
        severity: 'INFO',
        timestamp: 'Just now',
        read: false,
      },
    ];
  });

  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return { pushEnabled: true, soundEnabled: true };
  });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Save notifications
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)));
    } catch {
      // ignore
    }
  }, [notifications]);

  // Save settings
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Custom Event Listener for in-app push notifications from any page
  useEffect(() => {
    function handleCustomPush(e: Event) {
      const customEvent = e as CustomEvent<InAppNotification>;
      if (!customEvent.detail) return;
      const item = customEvent.detail;

      setNotifications((prev) => [item, ...prev.filter((n) => n.id !== item.id)]);

      if (settings.pushEnabled) {
        showPushNotification({
          title: item.title,
          message: item.message,
          severity: item.severity,
          link: item.link,
          playSound: settings.soundEnabled,
          onAction: () => {
            if (item.link) navigate(item.link);
          },
        });
      }
    }

    window.addEventListener('crimelink:push-notification', handleCustomPush);
    return () => window.removeEventListener('crimelink:push-notification', handleCustomPush);
  }, [settings, navigate]);

  // Background poller for suspicious alerts: seed seen IDs from localStorage
  const seenAlertIds = useRef<Set<string>>((() => {
    try {
      const saved = localStorage.getItem(SEEN_ALERTS_KEY);
      if (saved) return new Set<string>(JSON.parse(saved));
    } catch {
      // ignore
    }
    return new Set<string>();
  })());

  useEffect(() => {
    let mounted = true;

    async function pollAlerts(isInitial = false) {
      try {
        const resp = await getSuspiciousPatterns();
        if (!mounted || !resp.alerts) return;

        let hasNewKeys = false;
        const newNotifs: InAppNotification[] = [];

        for (const al of resp.alerts) {
          const score = typeof al.risk_score === 'number' ? al.risk_score : 0;
          // Trigger push for high or critical risk patterns
          const isHighOrCritical = score >= 0.7 || score >= 70;
          const alertKey = `${al.entity_id}-${al.pattern_type}`;

          if (isHighOrCritical) {
            const isUnseen = !seenAlertIds.current.has(alertKey);

            if (isUnseen) {
              seenAlertIds.current.add(alertKey);
              hasNewKeys = true;

              const severity: PushSeverity = score >= 0.85 || score >= 85 ? 'CRITICAL' : 'HIGH';
              const entityLabel = al.entity_name || `Entity ${al.entity_id}`;
              const notif: InAppNotification = {
                id: `alert-${Date.now()}-${al.entity_id}`,
                title: `${severity === 'CRITICAL' ? 'Critical' : 'High-Risk'} Anomaly: ${entityLabel}`,
                message: `${al.pattern_type.replace(/_/g, ' ')}: ${al.explanation || 'Suspicious network topology detected.'}`,
                severity,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                read: false,
                link: `/network?focus=${encodeURIComponent(al.entity_id)}`,
                entityId: al.entity_id,
              };

              newNotifs.push(notif);

              // ONLY trigger pop-up push toast if this is a live new alert detected on subsequent polling cycles
              if (!isInitial && settings.pushEnabled) {
                showPushNotification({
                  title: notif.title,
                  message: notif.message,
                  severity: notif.severity,
                  link: notif.link,
                  actionLabel: 'Inspect in Network',
                  playSound: settings.soundEnabled,
                  onAction: () => {
                    navigate(notif.link!);
                  },
                });
              }
            }
          }
        }

        if (newNotifs.length > 0) {
          setNotifications((prev) => [...newNotifs, ...prev]);
        }

        if (hasNewKeys) {
          try {
            localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(Array.from(seenAlertIds.current)));
          } catch {
            // ignore
          }
        }
      } catch {
        // Backend might be quiet or down temporarily
      }
    }

    // Baseline initial check: marks all existing DB alerts as seen so they do NOT blast push toasts upon login
    pollAlerts(true);

    // Periodic check for new anomalies arriving in real-time
    const timer = setInterval(() => pollAlerts(false), 35000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [settings, navigate]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    showToast.success('Marked all notifications as read');
  };

  const clearAll = () => {
    setNotifications([]);
    toast.dismiss();
    showToast.info('Notification history cleared');
  };

  const triggerTestPush = () => {
    const testSeverities: PushSeverity[] = ['CRITICAL', 'HIGH', 'SUCCESS', 'INFO'];
    const randomSeverity = testSeverities[Math.floor(Math.random() * testSeverities.length)];

    const testItem: InAppNotification = {
      id: `test-${Date.now()}`,
      title:
        randomSeverity === 'CRITICAL'
          ? 'Critical Node Link Alert'
          : randomSeverity === 'HIGH'
          ? 'Multi-Entity Association Warning'
          : randomSeverity === 'SUCCESS'
          ? 'Pipeline Extraction Complete'
          : 'Case File Updated',
      message:
        randomSeverity === 'CRITICAL'
          ? 'High-confidence cross-envelope communication detected between suspect nodes.'
          : randomSeverity === 'HIGH'
          ? 'New financial intermediary linked to multiple active narcotics investigations.'
          : randomSeverity === 'SUCCESS'
          ? '14 entities extracted, 8 deduplicated, 22 graph edges mapped to Neo4j.'
          : 'Detective Ramos uploaded forensic transcript envelope #0492.',
      severity: randomSeverity,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: false,
      link: '/network',
    };

    setNotifications((prev) => [testItem, ...prev]);

    showPushNotification({
      title: testItem.title,
      message: testItem.message,
      severity: testItem.severity,
      link: testItem.link,
      actionLabel: 'View in Network Analysis',
      playSound: settings.soundEnabled,
      onAction: () => {
        navigate(testItem.link!);
      },
    });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-zinc-400 hover:text-black hover:bg-zinc-100 rounded-md cursor-pointer transition-colors"
        title="CrimeLink Push Notifications"
        aria-label="Push Notifications"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#141416] border border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden font-sans text-white animate-in fade-in slide-in-from-top-2 duration-150"
          style={{
            boxShadow: '0 20px 35px -5px rgba(0, 0, 0, 0.7), 0 0 15px -3px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#18181c]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="text-xs font-semibold text-white tracking-tight">Push Notifications</h3>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={triggerTestPush}
                className="text-[10px] font-mono text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded transition-colors"
                title="Fire a live push toast notification"
              >
                + Test Push
              </button>
            </div>
          </div>

          {/* Controls Bar: Push enabled + Sound */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/60 border-b border-zinc-800/80 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={settings.pushEnabled}
                onChange={(e) => {
                  const updated = { ...settings, pushEnabled: e.target.checked };
                  setSettings(updated);
                  if (e.target.checked) {
                    showToast.success('Push notifications enabled');
                  } else {
                    showToast.warning('Push notifications muted');
                  }
                }}
                className="rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="font-mono text-[10px]">Push Toasts</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => {
                  setSettings({ ...settings, soundEnabled: e.target.checked });
                  if (e.target.checked) {
                    showToast.info('Audio alert chime enabled');
                  }
                }}
                className="rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="font-mono text-[10px]">Sound Cue</span>
            </label>

            {notifications.length > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[10px] font-mono text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                Mark Read
              </button>
            )}
          </div>

          {/* List of Recent Notifications */}
          <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800/60 touch-scroll">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-xs">
                No notifications logged yet.
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`p-3.5 hover:bg-zinc-900/50 transition-colors ${
                    !notif.read ? 'bg-zinc-900/25' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          notif.severity === 'CRITICAL'
                            ? 'bg-red-400'
                            : notif.severity === 'HIGH'
                            ? 'bg-amber-400'
                            : notif.severity === 'SUCCESS'
                            ? 'bg-emerald-400'
                            : 'bg-blue-400'
                        }`}
                      />
                      <span className="text-[11px] font-semibold text-zinc-200 tracking-tight leading-tight line-clamp-1">
                        {notif.title}
                      </span>
                    </div>
                    <span className="text-[9px] font-mono text-zinc-500 shrink-0">
                      {notif.timestamp}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed line-clamp-2 pl-3">
                    {notif.message}
                  </p>

                  {notif.link && (
                    <div className="mt-2 pl-3">
                      <button
                        onClick={() => {
                          setIsOpen(false);
                          navigate(notif.link!);
                        }}
                        className="text-[10px] font-mono text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <span>Investigate</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 bg-[#18181c] border-t border-zinc-800 flex items-center justify-between text-[10px] font-mono text-zinc-400">
              <span>{notifications.length} total entries</span>
              <button
                onClick={clearAll}
                className="text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
              >
                Clear History
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Dispatches an in-app push notification event that updates the bell history and pops a toast
 */
export function emitPushNotification(notification: Omit<InAppNotification, 'id' | 'timestamp' | 'read'>) {
  const item: InAppNotification = {
    ...notification,
    id: `push-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    read: false,
  };
  window.dispatchEvent(new CustomEvent('crimelink:push-notification', { detail: item }));
}
