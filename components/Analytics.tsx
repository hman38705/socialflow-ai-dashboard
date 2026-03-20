import React from 'react';
import { Card } from './ui/Card';
import { ViewProps } from '../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const engagementData = [
  { name: 'Jan', fb: 4000, ig: 2400, tt: 2400 },
  { name: 'Feb', fb: 3000, ig: 1398, tt: 2210 },
  { name: 'Mar', fb: 2000, ig: 9800, tt: 2290 },
  { name: 'Apr', fb: 2780, ig: 3908, tt: 2000 },
  { name: 'May', fb: 1890, ig: 4800, tt: 2181 },
  { name: 'Jun', fb: 2390, ig: 3800, tt: 2500 },
];

const ageData = [
  { name: '18-24', value: 400 },
  { name: '25-34', value: 300 },
  { name: '35-44', value: 300 },
  { name: '45+', value: 200 },
];

const COLORS = ['#3b82f6', '#14b8a6', '#a855f7', '#fb923c'];

export const Analytics: React.FC<ViewProps> = () => {
  const handleExport = () => {
    console.log("Downloading report as PDF...");
    alert("Downloading report as PDF... (Check console for details)");
  };

  return (
    <div className="p-7 space-y-7 animate-fade-in">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Detailed Analytics</h2>
        <div className="flex gap-4">
           <button 
             onClick={handleExport}
             className="flex items-center gap-2 bg-primary-blue text-white px-5 py-2.5 rounded-2xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20"
           >
             <MaterialIcon name="download" className="text-base" />
             Export Report
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-white mb-6">Cross-Platform Growth</h3>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={engagementData}>
                <defs>
                  <linearGradient id="colorIg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d946ef" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#d946ef" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorFb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#8892b0'}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#8892b0'}} />
                <Tooltip contentStyle={{ backgroundColor: '#161b22', borderColor: '#334155', borderRadius: '20px' }} />
                <Area type="monotone" dataKey="ig" stroke="#d946ef" strokeWidth={3} fillOpacity={1} fill="url(#colorIg)" name="Instagram" />
                <Area type="monotone" dataKey="fb" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorFb)" name="Facebook" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold text-white mb-6">Audience Age</h3>
          <div className="h-[250px] relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ageData}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {ageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#161b22', borderColor: '#334155', borderRadius: '20px' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <span className="block text-2xl font-bold text-white">1.2M</span>
              <span className="text-xs text-gray-subtext">Total Audience</span>
            </div>
          </div>
          <div className="mt-6 space-y-3">
             {ageData.map((entry, index) => (
               <div key={entry.name} className="flex justify-between items-center text-sm">
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[index]}}></div>
                    <span className="text-white">{entry.name}</span>
                 </div>
                 <span className="font-medium text-white">{Math.round((entry.value / 1200) * 100)}%</span>
               </div>
             ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <h3 className="text-lg font-semibold text-white mb-4">Top Territories</h3>
          {/* Simulated Geo Map via Bar List */}
          <div className="space-y-4">
            {[
              { country: 'United States', val: 78, flag: '🇺🇸' },
              { country: 'United Kingdom', val: 64, flag: '🇬🇧' },
              { country: 'Germany', val: 45, flag: '🇩🇪' },
              { country: 'Canada', val: 32, flag: '🇨🇦' },
            ].map((item) => (
              <div key={item.country}>
                <div className="flex justify-between text-sm mb-2">
                   <span className="flex items-center gap-2 text-white">
                     <span>{item.flag}</span> {item.country}
                   </span>
                   <span className="text-gray-subtext">{item.val}%</span>
                </div>
                <div className="w-full h-2 bg-dark-surface rounded-full">
                  <div className="h-full bg-primary-blue rounded-full" style={{ width: `${item.val}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        
        <Card>
           <h3 className="text-lg font-semibold text-white mb-4">Best Posting Times</h3>
           {/* Heatmap Simulation */}
           <div className="grid grid-cols-7 gap-1">
              {['M','T','W','T','F','S','S'].map(d => <div key={d} className="text-center text-xs text-gray-subtext mb-2">{d}</div>)}
              {Array.from({ length: 49 }).map((_, i) => {
                 const intensity = Math.random();
                 let bg = 'bg-dark-surface';
                 if (intensity > 0.8) bg = 'bg-primary-teal';
                 else if (intensity > 0.5) bg = 'bg-teal-700';
                 else if (intensity > 0.2) bg = 'bg-teal-900';
                 
                 return <div key={i} className={`w-full pt-[100%] rounded-md ${bg} relative group hover:ring-2 hover:ring-white/20 transition-all`}>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] font-bold text-black drop-shadow-md">{Math.floor(intensity * 100)}%</span>
                    </div>
                 </div>
              })}
           </div>
        </Card>
      </div>
    </div>
  );
};
