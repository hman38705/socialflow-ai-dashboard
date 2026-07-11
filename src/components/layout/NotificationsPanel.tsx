import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Notification {
  id: string;
  icon: string;
  title: string;
  time: string;
  unread: boolean;
  color: string;
}

const INITIAL: Notification[] = [
  { id: 'n1', icon: 'trending_up', title: 'Your Instagram post hit 12k reach — 18% above forecast.', time: '2m ago', unread: true, color: 'text-green-400' },
  { id: 'n2', icon: 'schedule', title: 'TikTok post scheduled for 4:00 PM is ready.', time: '1h ago', unread: true, color: 'text-primary-blue' },
  { id: 'n3', icon: 'psychology', title: 'Reach model retrained — accuracy improved to 94%.', time: '5h ago', unread: false, color: 'text-primary-purple' },
  { id: 'n4', icon: 'group_add', title: 'You gained 420 new followers this week.', time: '1d ago', unread: false, color: 'text-primary-teal' },
];

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const NotificationsPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>(INITIAL);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = items.filter((i) => i.unread).length;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const markAllRead = () => setItems((prev) => prev.map((i) => ({ ...i, unread: false })));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex items-center justify-center w-10 h-10 border border-dark-border rounded-xl cursor-pointer hover:bg-white/5 transition-all"
      >
        <MaterialIcon name="notifications" className="text-gray-400" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-3 w-80 glass-card z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
              <p className="text-sm font-bold text-white">Notifications</p>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] font-bold text-primary-blue hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() =>
                    setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, unread: false } : i)))
                  }
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-white/5 last:border-0 transition-colors hover:bg-white/5 ${
                    n.unread ? 'bg-white/[0.03]' : ''
                  }`}
                >
                  <MaterialIcon name={n.icon} className={`text-lg mt-0.5 ${n.color}`} />
                  <span className="flex-1">
                    <span className="block text-xs text-white/90 leading-snug">{n.title}</span>
                    <span className="block text-[10px] text-gray-subtext mt-1">{n.time}</span>
                  </span>
                  {n.unread && <span className="w-2 h-2 rounded-full bg-primary-blue mt-1.5" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
