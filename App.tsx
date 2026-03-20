import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { Analytics } from './components/Analytics';
import { Calendar } from './components/Calendar';
import { CreatePost } from './components/CreatePost';
import { MediaLibrary } from './components/MediaLibrary';
import { Inbox } from './components/Inbox';
import { Settings } from './components/Settings';
import { View } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>(View.DASHBOARD);

  const renderView = () => {
    const props = { onNavigate: setCurrentView };
    
    switch (currentView) {
      case View.DASHBOARD: return <Dashboard {...props} />;
      case View.ANALYTICS: return <Analytics {...props} />;
      case View.CALENDAR: return <Calendar {...props} />;
      case View.CREATE_POST: return <CreatePost {...props} />;
      case View.MEDIA_LIBRARY: return <MediaLibrary {...props} />;
      case View.INBOX: return <Inbox {...props} />;
      case View.SETTINGS: return <Settings {...props} />;
      default: return <Dashboard {...props} />;
    }
  };

  return (
    <div className="flex h-screen bg-dark-bg text-white font-sans overflow-hidden selection:bg-primary-blue/30">
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />
      
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Abstract Background Blobs */}
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-primary-blue/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-primary-teal/10 rounded-full blur-[120px] pointer-events-none" />

        <Header />
        
        <main className="flex-1 overflow-y-auto overflow-x-hidden relative z-10 scroll-smooth">
          {renderView()}
        </main>
      </div>
    </div>
  );
};

export default App;