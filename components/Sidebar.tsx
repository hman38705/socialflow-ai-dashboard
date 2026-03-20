import React from 'react';
import { View, NavItem } from '../types';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const MaterialIcon = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined">{name}</span>
);

const navItems: NavItem[] = [
  { id: View.DASHBOARD, label: 'Dashboard', icon: <MaterialIcon name="dashboard" /> },
  { id: View.ANALYTICS, label: 'Analytics', icon: <MaterialIcon name="bar_chart" /> },
  { id: View.CALENDAR, label: 'Calendar', icon: <MaterialIcon name="calendar_today" /> },
  { id: View.CREATE_POST, label: 'Create Post', icon: <MaterialIcon name="edit_square" /> },
  { id: View.MEDIA_LIBRARY, label: 'Media', icon: <MaterialIcon name="photo_library" /> },
  { id: View.INBOX, label: 'Inbox', icon: <MaterialIcon name="inbox" /> },
  { id: View.SETTINGS, label: 'Settings', icon: <MaterialIcon name="settings" /> },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  return (
    <div className="w-72 h-full flex flex-col p-6 border-r border-white/5 bg-[#111315]">
      <div className="flex items-center gap-3 mb-10 px-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-blue to-primary-teal flex items-center justify-center">
          <MaterialIcon name="bolt" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">SocialFlow</h1>
      </div>

      <nav className="flex-1 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl transition-all duration-200 group ${
              currentView === item.id
                ? 'bg-primary-blue/10 text-primary-blue'
                : 'text-gray-subtext hover:text-white hover:bg-white/5'
            }`}
          >
            <span className={`transition-colors ${currentView === item.id ? 'text-primary-blue' : 'text-gray-subtext group-hover:text-white'}`}>
              {item.icon}
            </span>
            <span className="font-medium text-sm">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
        <button 
          onClick={() => { if(confirm("Are you sure you want to logout?")) console.log("Logged out"); }}
          className="w-full flex items-center gap-4 px-5 py-3.5 rounded-2xl text-gray-subtext hover:text-red-400 hover:bg-red-400/5 transition-colors"
        >
          <MaterialIcon name="logout" />
          <span className="font-medium text-sm">Logout</span>
        </button>
      </div>
    </div>
  );
};