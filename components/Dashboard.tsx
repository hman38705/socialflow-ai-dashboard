import React, { useState, useEffect, useRef } from 'react';
import { Card } from './ui/Card';
import { ViewProps } from '../types';
import { SiInstagram, SiYoutube, SiFacebook, SiLinkedin } from 'react-icons/si';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const data = [
  { name: 'Mon', value: 4000 },
  { name: 'Tue', value: 3000 },
  { name: 'Wed', value: 5000 },
  { name: 'Thu', value: 2780 },
  { name: 'Fri', value: 1890 },
  { name: 'Sat', value: 2390 },
  { name: 'Sun', value: 3490 },
];

const activityData = [
  { id: 1, type: 'post', platform: 'Instagram', text: 'New post published', time: '2h ago' },
  { id: 2, type: 'milestone', platform: 'YouTube', text: 'Hit 10k subscribers', time: '4h ago' },
  { id: 3, type: 'alert', platform: 'System', text: 'Weekly report ready', time: '5h ago' },
  { id: 4, type: 'comment', platform: 'Facebook', text: 'High engagement on recent ad', time: '8h ago' },
];

export const Dashboard: React.FC<ViewProps> = ({ onNavigate }) => {
  const [timeRange, setTimeRange] = useState('Last 7 Days');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuRef]);

  return (
    <div className="p-7 space-y-7 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Overview</h2>
        <div className="flex gap-2">
          <select 
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="bg-dark-surface text-sm text-gray-subtext border border-dark-border rounded-xl px-4 py-2 focus:outline-none focus:border-primary-blue transition-colors"
          >
            <option>Last 7 Days</option>
            <option>Last 30 Days</option>
            <option>Last Quarter</option>
          </select>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Followers" 
          value={timeRange === 'Last 7 Days' ? "892.4k" : "910.2k"}
          change="+12.5%" 
          icon={<MaterialIcon name="group" className="text-primary-blue" />} 
        />
        <StatCard 
          title="Engagement Rate" 
          value={timeRange === 'Last 7 Days' ? "5.8%" : "6.1%"}
          change="+2.1%" 
          icon={<MaterialIcon name="monitoring" className="text-primary-teal" />} 
        />
        <StatCard 
          title="Total Reach" 
          value={timeRange === 'Last 7 Days' ? "1.2M" : "4.5M"}
          change="+8.4%" 
          icon={<MaterialIcon name="visibility" className="text-purple-400" />} 
        />
        <StatCard 
          title="Avg. Watch Time" 
          value="4m 12s" 
          change="-1.2%" 
          isNegative
          icon={<MaterialIcon name="trending_up" className="text-orange-400" />} 
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <div className="lg:col-span-2 space-y-7">
          <Card>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-semibold text-white">Performance Overview</h3>
                <p className="text-sm text-gray-subtext">Total engagement across all platforms</p>
              </div>
              <div className="relative" ref={menuRef}>
                <button 
                  onClick={() => setIsMenuOpen(prev => !prev)}
                  className="p-2 hover:bg-white/5 rounded-lg text-gray-subtext transition-colors"
                >
                  <MaterialIcon name="more_horiz" />
                </button>
                {isMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-dark-surface border border-dark-border rounded-2xl shadow-lg z-20 animate-fade-in-sm">
                    <button onClick={() => {alert('Exporting data...'); setIsMenuOpen(false);}} className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-white hover:bg-white/5"><MaterialIcon name="download" className="text-sm" /> Export Data</button>
                    <button onClick={() => {alert('Refreshing...'); setIsMenuOpen(false);}} className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-white hover:bg-white/5"><MaterialIcon name="refresh" className="text-sm" /> Refresh</button>
                    <button onClick={() => {alert('Opening settings...'); setIsMenuOpen(false);}} className="w-full text-left flex items-center gap-2 px-4 py-2 text-sm text-white hover:bg-white/5"><MaterialIcon name="settings" className="text-sm" /> Settings</button>
                  </div>
                )}
              </div>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#8892b0', fontSize: 12}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#8892b0', fontSize: 12}} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <Card>
                <h3 className="text-lg font-semibold text-white mb-4">Accounts Reach</h3>
                <div className="space-y-4">
                  <AccountRow icon={<SiInstagram size={18} />} name="Instagram" value="45%" color="bg-pink-500" />
                  <AccountRow icon={<SiYoutube size={18} />} name="YouTube" value="30%" color="bg-red-500" />
                  <AccountRow icon={<SiFacebook size={18} />} name="Facebook" value="15%" color="bg-blue-600" />
                  <AccountRow icon={<SiLinkedin size={18} />} name="LinkedIn" value="10%" color="bg-blue-700" />
                </div>
             </Card>
             <Card>
                <div className="flex justify-between items-end mb-4">
                   <h3 className="text-lg font-semibold text-white">Campaign ROI</h3>
                   <span className="text-2xl font-bold text-primary-teal">$12,450</span>
                </div>
                <div className="h-[150px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.slice(0,5)}>
                      <Bar dataKey="value" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
             </Card>
          </div>
        </div>

        {/* Right Sidebar - Activity */}
        <div className="space-y-6">
          <Card className="h-full">
            <h3 className="text-lg font-semibold text-white mb-6">Recent Activity</h3>
            <div className="space-y-8 relative">
              <div className="absolute left-[19px] top-2 bottom-2 w-[1px] bg-dark-border" />
              {activityData.map((item, index) => (
                <div key={item.id} className="relative flex items-start gap-4">
                  <div className={`relative z-10 w-10 h-10 rounded-full border-4 border-dark-surface flex items-center justify-center shrink-0 ${index === 0 ? 'bg-primary-blue' : 'bg-gray-700'}`}>
                    <div className="w-2 h-2 bg-white rounded-full" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{item.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-primary-blue bg-primary-blue/10 px-2 py-0.5 rounded-full">{item.platform}</span>
                      <span className="text-xs text-gray-subtext">{item.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <button 
              onClick={() => console.log("Showing full history log...")}
              className="w-full mt-8 py-3 rounded-2xl border border-dark-border text-sm font-medium text-gray-subtext hover:bg-white/5 transition-colors"
            >
              View All History
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, change, icon, isNegative = false }: any) => (
  <Card>
    <div className="flex justify-between items-start mb-4">
      <div>
        <p className="text-sm text-gray-subtext font-medium mb-1">{title}</p>
        <h4 className="text-2xl font-bold text-white">{value}</h4>
      </div>
      <div className="p-3 rounded-2xl bg-white/5">
        {icon}
      </div>
    </div>
    <div className="flex items-center gap-2">
      <span className={`flex items-center text-xs font-semibold px-2 py-1 rounded-lg ${isNegative ? 'bg-red-500/10 text-red-400' : 'bg-teal-500/10 text-teal-400'}`}>
        <MaterialIcon name="arrow_upward" className={`text-sm mr-1 ${isNegative ? 'rotate-90' : ''}`} />
        {change}
      </span>
      <span className="text-xs text-gray-subtext">vs last month</span>
    </div>
  </Card>
);

const AccountRow = ({ icon, name, value, color }: any) => (
  <div className="flex items-center gap-3">
    <div className={`w-10 h-10 rounded-lg ${color} bg-opacity-20 flex items-center justify-center text-white`}>
      {icon}
    </div>
    <div className="flex-1">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-white">{name}</span>
        <span className="text-gray-subtext">{value}</span>
      </div>
      <div className="w-full h-1.5 bg-dark-surface rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: value }} />
      </div>
    </div>
  </div>
);