import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { GlassCard } from '../components/ui/GlassCard';
import { StatBadge } from '../components/ui/StatBadge';
import { buildDailySeries, platformShare } from '../lib/sampleAnalytics';

const tooltipStyle = {
  background: 'rgba(15,15,22,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '12px',
  fontSize: '12px',
  color: '#fff',
};

export const AnalyticsPage: React.FC = () => {
  const series = useMemo(() => buildDailySeries(4), []);

  const totalReach = series.reduce((a, c) => a + c.reach, 0);
  const totalEngagement = series.reduce((a, c) => a + c.engagement, 0);
  const followerGain = series[series.length - 1].followers - series[0].followers;
  const engagementRate = ((totalEngagement / totalReach) * 100).toFixed(1);

  return (
    <div className="space-y-10 pb-20">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatBadge label="28-Day Reach" value={`${(totalReach / 1000).toFixed(0)}k`} icon="visibility" color="blue" trend="up" />
        <StatBadge label="Engagement" value={`${(totalEngagement / 1000).toFixed(1)}k`} icon="favorite" color="purple" trend="up" />
        <StatBadge label="Follower Gain" value={`+${(followerGain / 1000).toFixed(1)}k`} icon="group_add" color="teal" trend="up" />
        <StatBadge label="Eng. Rate" value={`${engagementRate}%`} icon="bolt" color="yellow" />
      </div>

      <GlassCard>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">Reach &amp; Engagement</h3>
            <p className="text-xs text-gray-subtext">Rolling 4-week performance</p>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-bold">
            <span className="flex items-center gap-1.5 text-primary-blue"><span className="w-2 h-2 rounded-full bg-primary-blue" />Reach</span>
            <span className="flex items-center gap-1.5 text-primary-purple"><span className="w-2 h-2 rounded-full bg-primary-purple" />Engagement</span>
          </div>
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ left: -18, right: 8, top: 4 }}>
              <defs>
                <linearGradient id="reachGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4f83ff" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#4f83ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="engGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={3} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
              <Area type="monotone" dataKey="reach" stroke="#4f83ff" strokeWidth={2} fill="url(#reachGrad)" />
              <Area type="monotone" dataKey="engagement" stroke="#8b5cf6" strokeWidth={2} fill="url(#engGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <GlassCard>
          <h3 className="text-lg font-bold text-white tracking-tight mb-6">Reach by Platform</h3>
          <div className="h-64 w-full flex items-center">
            <ResponsiveContainer width="55%" height="100%">
              <PieChart>
                <Pie data={platformShare} dataKey="value" nameKey="platform" innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                  {platformShare.map((entry) => (
                    <Cell key={entry.platform} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-3">
              {platformShare.map((p) => (
                <div key={p.platform} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-300">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                    {p.platform}
                  </span>
                  <span className="font-bold text-white">{p.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="text-lg font-bold text-white tracking-tight mb-6">Weekly Engagement</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series.filter((_, i) => i % 2 === 0)} margin={{ left: -18, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="engagement" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
