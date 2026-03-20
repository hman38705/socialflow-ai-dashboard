import React, { useState, useRef, useEffect } from 'react';

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const Header: React.FC = () => {
  const [searchValue, setSearchValue] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  
  const notificationsRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const useOutsideAlerter = (ref: React.RefObject<HTMLDivElement>, close: () => void) => {
    useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (ref.current && !ref.current.contains(event.target as Node)) {
          close();
        }
      }
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [ref, close]);
  }

  useOutsideAlerter(notificationsRef, () => setNotificationsOpen(false));
  useOutsideAlerter(profileMenuRef, () => setProfileMenuOpen(false));

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchValue.trim() !== '') {
        console.log(`Searching for: ${searchValue}`);
        alert(`Searching for: ${searchValue}`);
      }
    }
  }

  return (
    <header className="h-24 px-8 flex items-center justify-between border-b border-dark-border bg-dark-bg/50 backdrop-blur-md sticky top-0 z-20 app-drag-region">
      <div className="flex-1 max-w-xl app-no-drag">
        <div className="relative group">
          <MaterialIcon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-subtext group-focus-within:text-primary-blue transition-colors" />
          <input 
            type="text" 
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={handleSearch}
            placeholder="Search analytics, posts, or messages..." 
            className="w-full bg-dark-surface border border-dark-border rounded-2xl py-3 pl-12 pr-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary-blue/50 transition-all placeholder:text-gray-subtext"
          />
        </div>
      </div>

      <div className="flex items-center gap-6 app-no-drag">
        <div className="relative" ref={notificationsRef}>
          <button 
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className={`relative p-2 transition-colors ${notificationsOpen ? 'text-white' : 'text-gray-subtext hover:text-white'}`}
          >
            <MaterialIcon name="notifications" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-dark-bg"></span>
          </button>
          
          {notificationsOpen && (
              <div className="absolute top-full right-0 mt-4 w-80 bg-dark-surface border border-dark-border rounded-2xl shadow-2xl p-4 z-50 animate-fade-in-sm">
                  <h3 className="text-white font-semibold mb-2 text-sm">Notifications</h3>
                  <div className="space-y-2">
                      <div onClick={() => console.log("Notification clicked: New comment")} className="text-sm text-gray-subtext p-2 hover:bg-white/5 rounded-lg cursor-pointer">New comment on your post</div>
                      <div onClick={() => console.log("Notification clicked: Post published")} className="text-sm text-gray-subtext p-2 hover:bg-white/5 rounded-lg cursor-pointer">Scheduled post published</div>
                      <div onClick={() => console.log("Notification clicked: Report ready")} className="text-sm text-gray-subtext p-2 hover:bg-white/5 rounded-lg cursor-pointer">Weekly analytics report ready</div>
                  </div>
              </div>
          )}
        </div>
        
        <div className="relative" ref={profileMenuRef}>
          <div onClick={() => setProfileMenuOpen(!profileMenuOpen)} className="flex items-center gap-3 pl-6 border-l border-dark-border cursor-pointer hover:opacity-80 transition-opacity">
            <img 
              src="https://picsum.photos/100/100" 
              alt="Profile" 
              className="w-10 h-10 rounded-full object-cover border-2 border-dark-border"
            />
            <div className="hidden md:block text-left">
              <p className="text-sm font-semibold text-white leading-tight">Alex Morgan</p>
              <p className="text-xs text-gray-subtext">Pro Plan</p>
            </div>
            <MaterialIcon name="expand_more" className={`text-gray-subtext hidden md:block transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
          </div>

          {profileMenuOpen && (
            <div className="absolute top-full right-0 mt-3 w-48 bg-dark-surface border border-dark-border rounded-2xl shadow-lg z-20 animate-fade-in-sm">
              <button onClick={() => {alert('Opening profile...'); setProfileMenuOpen(false);}} className="w-full text-left flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-white/5"><MaterialIcon name="person" /> Profile</button>
              <button onClick={() => {alert('Opening billing...'); setProfileMenuOpen(false);}} className="w-full text-left flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-white/5"><MaterialIcon name="credit_card" /> Billing</button>
              <div className="h-px bg-dark-border my-1"></div>
              <button onClick={() => {if(confirm("Are you sure?")) {alert('Logging out...'); setProfileMenuOpen(false);}}} className="w-full text-left flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-400/10"><MaterialIcon name="logout" /> Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};