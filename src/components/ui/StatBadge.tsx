import React from 'react';

interface StatBadgeProps {
  label: string;
  value: string | number;
  icon: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'blue' | 'teal' | 'purple' | 'yellow' | 'red' | 'rose';
}

export const StatBadge: React.FC<StatBadgeProps> = ({
  label,
  value,
  icon,
  trend = 'neutral',
  color = 'blue'
}) => {
  const colorMap = {
    blue: 'from-primary-blue/20 to-primary-blue/5 text-primary-blue border-primary-blue/25',
    teal: 'from-primary-teal/20 to-primary-teal/5 text-primary-teal border-primary-teal/25',
    purple: 'from-primary-purple/20 to-primary-purple/5 text-primary-purple border-primary-purple/25',
    rose: 'from-primary-rose/20 to-primary-rose/5 text-primary-rose border-primary-rose/25',
    yellow: 'from-amber-500/20 to-amber-600/5 text-amber-400 border-amber-500/25',
    red: 'from-red-500/20 to-red-600/5 text-red-400 border-red-500/25',
  };

  return (
    <div className={`flex flex-col items-center justify-center p-4 rounded-2xl border bg-gradient-to-br ${colorMap[color]} backdrop-blur-sm transition-all hover:scale-[1.03] active:scale-95 cursor-default shadow-elev-1`}>
      <span className="material-symbols-outlined text-3xl mb-2 opacity-80">{icon}</span>
      <p className="tnum text-2xl font-bold text-white glow-text">{value}</p>
      <p className="text-[10px] uppercase font-bold tracking-widest opacity-60 mt-1 text-center">{label}</p>

      {trend !== 'neutral' && (
        <div className={`mt-2 flex items-center gap-1 text-[10px] font-bold tnum ${trend === 'up' ? 'text-trend-up' : 'text-trend-down'}`}>
          <span className="material-symbols-outlined text-xs">
            {trend === 'up' ? 'trending_up' : 'trending_down'}
          </span>
          {trend === 'up' ? '+12.5%' : '-3.2%'}
        </div>
      )}
    </div>
  );
};
