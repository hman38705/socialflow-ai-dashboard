import React, { useState } from 'react';
import { Card } from './ui/Card';
import { ViewProps, View } from '../types';
import { SiInstagram, SiFacebook, SiYoutube } from 'react-icons/si';

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const posts = [
  { id: 1, date: 12, title: 'Product Launch', platform: 'ig', color: 'bg-purple-500' },
  { id: 2, date: 12, title: 'Story Update', platform: 'fb', color: 'bg-blue-600' },
  { id: 3, date: 15, title: 'Weekly Vlog', platform: 'yt', color: 'bg-red-500' },
  { id: 4, date: 18, title: 'Tips & Tricks', platform: 'ig', color: 'bg-purple-500' },
];

export const Calendar: React.FC<ViewProps> = ({ onNavigate }) => {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [currentDate, setCurrentDate] = useState(new Date(2023, 9, 14)); // October 14, 2023

  const handleCreatePost = () => {
    onNavigate(View.CREATE_POST);
  };

  const handlePrev = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNext = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const monthName = currentDate.toLocaleString('default', { month: 'long' });
  const year = currentDate.getFullYear();

  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();

  return (
    <div className="p-7 h-full flex flex-col animate-fade-in">
      <div className="flex justify-between items-center mb-7">
        <div>
           <h2 className="text-2xl font-bold text-white">Content Calendar</h2>
           <p className="text-gray-subtext text-sm">{`${monthName} ${year}`}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-dark-surface rounded-2xl p-1 border border-dark-border">
            <button 
              onClick={() => setViewMode('month')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'month' ? 'bg-white/10 text-white' : 'text-gray-subtext hover:text-white'}`}
            >
              Month
            </button>
            <button 
              onClick={() => setViewMode('week')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'week' ? 'bg-white/10 text-white' : 'text-gray-subtext hover:text-white'}`}
            >
              Week
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrev} className="p-2 hover:bg-white/10 rounded-lg text-gray-subtext"><MaterialIcon name="chevron_left" /></button>
            <button onClick={handleNext} className="p-2 hover:bg-white/10 rounded-lg text-gray-subtext"><MaterialIcon name="chevron_right" /></button>
          </div>
          <button 
            onClick={handleCreatePost}
            className="flex items-center gap-2 bg-primary-blue hover:bg-blue-700 text-white px-4 py-2 rounded-2xl transition-colors shadow-lg shadow-blue-500/20"
          >
            <MaterialIcon name="add" />
            <span className="text-sm font-medium">Create Post</span>
          </button>
        </div>
      </div>

      <div className="flex-1 bg-dark-surface/50 rounded-3xl border border-dark-border overflow-hidden flex flex-col">
        {/* Calendar Header */}
        <div className="grid grid-cols-7 border-b border-dark-border">
          {days.map(day => (
            <div key={day} className="py-4 text-center text-sm font-semibold text-gray-subtext">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar Grid */}
        <div className="flex-1 grid grid-cols-7 auto-rows-fr">
          {Array.from({ length: 35 }).map((_, i) => {
            const date = i - firstDayOfMonth + 1;
            const dayPosts = date > 0 && date <= daysInMonth && currentDate.getMonth() === 9 && currentDate.getFullYear() === 2023 ? posts.filter(p => p.date === date) : [];
            const isToday = new Date().toDateString() === new Date(currentDate.getFullYear(), currentDate.getMonth(), date).toDateString();
            const hasDate = date > 0 && date <= daysInMonth;

            return (
              <div 
                key={i} 
                className={`min-h-[120px] border-b border-r border-dark-border p-3 relative group transition-colors hover:bg-white/[0.02] ${i % 7 === 6 ? 'border-r-0' : ''} ${i >= 28 ? 'border-b-0' : ''}`}
                onClick={() => hasDate && console.log(`Clicked date: ${monthName} ${date}`)}
              >
                {hasDate && (
                  <>
                    <span className={`text-sm font-medium ${isToday ? 'bg-primary-blue w-7 h-7 flex items-center justify-center rounded-full text-white' : 'text-gray-subtext'}`}>
                      {date}
                    </span>
                    <div className="mt-2 space-y-2">
                      {dayPosts.map(post => (
                        <div 
                          key={post.id} 
                          className="bg-dark-bg border border-dark-border rounded-lg p-2 cursor-pointer hover:border-primary-blue/50 transition-colors group/card"
                          onClick={(e) => { e.stopPropagation(); console.log(`Editing post: ${post.title}`); onNavigate(View.CREATE_POST); }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                             <div className={`w-1.5 h-1.5 rounded-full ${post.color}`} />
                             <span className="text-xs text-white font-medium truncate">{post.title}</span>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                             {post.platform === 'ig' && <SiInstagram size={10} className="text-gray-subtext" />}
                             {post.platform === 'fb' && <SiFacebook size={10} className="text-gray-subtext" />}
                             {post.platform === 'yt' && <SiYoutube size={10} className="text-gray-subtext" />}
                             <span className="text-[10px] text-gray-subtext">09:00 AM</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <button 
                      onClick={(e) => { e.stopPropagation(); onNavigate(View.CREATE_POST); }}
                      className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-primary-blue text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-blue-700"
                    >
                      <MaterialIcon name="add" className="text-base" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};