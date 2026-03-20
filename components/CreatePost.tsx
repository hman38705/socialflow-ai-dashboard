import React, { useState, useRef, useEffect } from 'react';
import { Card } from './ui/Card';
import { Platform, ViewProps, View } from '../types';
import { generateCaption } from '../services/geminiService';
import { SiInstagram, SiFacebook, SiLinkedin } from 'react-icons/si';
import { FaXTwitter } from 'react-icons/fa6';

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const CreatePost: React.FC<ViewProps> = ({ onNavigate }) => {
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([Platform.INSTAGRAM]);
  const [caption, setCaption] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [topic, setTopic] = useState('');
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [tempTopic, setTempTopic] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('10:00');

  const getTodayString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  useEffect(() => {
    const savedDraft = localStorage.getItem('socialflow-draft');
    if (savedDraft) {
      const draft = JSON.parse(savedDraft);
      setCaption(draft.caption || '');
      setSelectedPlatforms(draft.selectedPlatforms || [Platform.INSTAGRAM]);
      setMediaPreview(draft.mediaPreview || null);
      setTopic(draft.topic || '');
      setScheduleDate(draft.scheduleDate || getTodayString());
      setScheduleTime(draft.scheduleTime || '10:00');
      setSaveStatus('Draft loaded');
      setTimeout(() => setSaveStatus(''), 2000);
    } else {
      setScheduleDate(getTodayString());
    }
  }, []);

  const togglePlatform = (p: Platform) => {
    if (selectedPlatforms.includes(p)) {
      setSelectedPlatforms(prev => prev.filter(item => item !== p));
    } else {
      setSelectedPlatforms(prev => [...prev, p]);
    }
  };

  const handleAiGenerate = async () => {
    if (!topic) return;
    setIsGenerating(true);
    const generatedText = await generateCaption(topic, selectedPlatforms[0]);
    setCaption(generatedText);
    setIsGenerating(false);
  };

  const handleMediaClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setMediaFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        const url = reader.result as string;
        setMediaPreview(url);
      };
      reader.readAsDataURL(file);
    }
  };

  const insertAtCursor = (text: string) => {
    setCaption(prev => prev + text);
  };

  const handleSaveDraft = () => {
    const draft = { caption, selectedPlatforms, mediaPreview, topic, scheduleDate, scheduleTime };
    localStorage.setItem('socialflow-draft', JSON.stringify(draft));
    setSaveStatus('Draft saved!');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const handleClearDraft = () => {
    localStorage.removeItem('socialflow-draft');
    setCaption('');
    setSelectedPlatforms([Platform.INSTAGRAM]);
    setMediaPreview(null);
    setTopic('');
    setMediaFile(null);
    setScheduleDate(getTodayString());
    setScheduleTime('10:00');
    if(fileInputRef.current) fileInputRef.current.value = '';
    setSaveStatus('Draft cleared!');
    setTimeout(() => setSaveStatus(''), 2000);
  }

  const handleSchedule = () => {
    if (!caption && !mediaFile) {
      alert("Please add some content to schedule.");
      return;
    }
    const button = document.getElementById('schedule-btn');
    if(button) button.innerText = "Scheduling...";
    
    setTimeout(() => {
        console.log("Post scheduled:", { caption, selectedPlatforms, mediaFile, scheduleDate, scheduleTime });
        handleClearDraft();
        alert("Post scheduled successfully! Check console for details.");
        onNavigate(View.CALENDAR);
    }, 1000);
  };

  const handleTopicEdit = () => {
    setTempTopic(topic);
    setIsEditingTopic(true);
  }

  const handleTopicSave = () => {
    setTopic(tempTopic);
    setIsEditingTopic(false);
  }

  return (
    <div className="p-7 max-w-5xl mx-auto animate-fade-in">
      <div className="flex justify-between items-center mb-7">
        <h2 className="text-2xl font-bold text-white">Create New Post</h2>
        <div className="flex gap-4 items-center">
           {saveStatus && (
             <div className="text-green-400 text-sm font-medium flex items-center gap-2">
               <MaterialIcon name="check_circle" className="text-base" />
               {saveStatus}
             </div>
           )}
           <button 
             onClick={handleSaveDraft}
             className="text-gray-subtext hover:text-white text-sm font-medium px-4 py-2"
           >
             Save Draft
           </button>
            <button 
             onClick={handleClearDraft}
             className="text-gray-subtext hover:text-red-500 text-sm font-medium px-4 py-2"
           >
             Clear Draft
           </button>
           <button 
             id="schedule-btn"
             onClick={handleSchedule}
             className="bg-primary-blue text-white px-6 py-3 rounded-2xl text-sm font-medium hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all"
           >
             Schedule Post
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <span className="text-sm font-medium text-gray-subtext mr-2">Post to:</span>
            <div className="flex gap-4 items-center mt-2">
            {[
              { id: Platform.INSTAGRAM, icon: <SiInstagram size={20} />, label: 'Instagram' },
              { id: Platform.FACEBOOK, icon: <SiFacebook size={20} />, label: 'Facebook' },
              { id: Platform.X, icon: <FaXTwitter size={20} />, label: 'X' },
              { id: Platform.LINKEDIN, icon: <SiLinkedin size={20} />, label: 'LinkedIn' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => togglePlatform(p.id)}
                className={`p-3 rounded-2xl border-2 transition-all duration-200 ${
                  selectedPlatforms.includes(p.id) 
                  ? 'border-primary-blue bg-primary-blue/10 text-white' 
                  : 'border-dark-border bg-dark-bg text-gray-subtext hover:border-gray-500'
                }`}
                title={p.label}
              >
                {p.icon}
              </button>
            ))}
            </div>
          </Card>

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
            accept="image/*,video/*"
          />
          <div 
            onClick={handleMediaClick}
            className={`h-64 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center transition-all cursor-pointer group relative overflow-hidden ${
                mediaPreview ? 'border-primary-blue/50 bg-dark-bg' : 'border-dark-border bg-dark-surface/50 hover:bg-dark-surface hover:border-primary-blue/30'
            }`}
          >
             {mediaPreview ? (
                <>
                    <img src={mediaPreview} alt="Preview" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white font-medium">Click to change</span>
                    </div>
                </>
             ) : (
                <>
                    <div className="w-16 h-16 rounded-full bg-dark-bg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <MaterialIcon name="image" className="text-gray-subtext group-hover:text-primary-blue text-3xl" />
                    </div>
                    <p className="text-gray-subtext font-medium">Drag and drop media here</p>
                    <p className="text-gray-600 text-sm mt-1">or click to browse</p>
                </>
             )}
          </div>

          <Card>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">Caption</h3>
              <div className="flex items-center gap-2">
                {isEditingTopic ? (
                  <>
                    <input 
                      type="text"
                      value={tempTopic}
                      onChange={(e) => setTempTopic(e.target.value)}
                      className="bg-dark-bg border border-dark-border rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary-blue/50"
                      placeholder="Enter topic"
                    />
                    <button onClick={handleTopicSave} className="text-xs text-green-400 hover:text-green-300">Save</button>
                    <button onClick={() => setIsEditingTopic(false)} className="text-xs text-gray-subtext hover:text-white">Cancel</button>
                  </>
                ) : (
                  <button 
                    onClick={handleTopicEdit}
                    className="flex items-center gap-2 text-xs text-primary-blue hover:text-blue-300"
                  >
                     <MaterialIcon name="edit" className="text-sm" />
                     {topic ? `Topic: ${topic}` : "Set Topic for AI"}
                  </button>
                )}
              </div>
            </div>
            
            <div className="relative">
              <textarea 
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full h-40 bg-dark-bg border border-dark-border rounded-2xl p-4 text-white focus:outline-none focus:ring-1 focus:ring-primary-blue/50 resize-none"
                placeholder="Write your caption here..."
              />
              <div className="absolute bottom-3 right-3 flex gap-2">
                 <button onClick={() => insertAtCursor('😊')} className="p-2 hover:bg-white/10 rounded-lg text-gray-subtext"><MaterialIcon name="mood" /></button>
                 <button onClick={() => insertAtCursor('#')} className="p-2 hover:bg-white/10 rounded-lg text-gray-subtext"><MaterialIcon name="tag" /></button>
              </div>
            </div>

            <div className="mt-4 flex justify-between items-center">
               <div className="text-xs text-gray-subtext">
                  {caption.length} characters • {30 - (caption.match(/#/g) || []).length} hashtags remaining
               </div>
               <button 
                  onClick={handleAiGenerate}
                  disabled={!topic || isGenerating}
                  className="flex items-center gap-2 bg-gradient-to-r from-primary-blue to-primary-teal text-white px-4 py-2 rounded-2xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity shadow-lg shadow-blue-500/20"
               >
                 <MaterialIcon name="auto_awesome" className={`text-base ${isGenerating ? "animate-spin" : ""}`} />
                 {isGenerating ? 'Generating...' : 'AI Generate'}
               </button>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h3 className="text-lg font-semibold text-white mb-4">Scheduling</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-subtext mb-1">Date</label>
                <div className="flex items-center gap-2 bg-dark-bg p-3 rounded-2xl border border-dark-border text-white">
                   <MaterialIcon name="calendar_today" className="text-base" />
                   <input 
                     type="date"
                     value={scheduleDate}
                     min={getTodayString()}
                     onChange={(e) => setScheduleDate(e.target.value)}
                     className="bg-transparent focus:outline-none w-full text-sm text-white" 
                     style={{ colorScheme: 'dark' }}
                   />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-subtext mb-1">Time</label>
                <div className="flex gap-2">
                  <div className="flex-1 bg-dark-bg p-3 rounded-2xl border border-dark-border text-white text-center text-sm">
                    <input 
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="bg-transparent focus:outline-none w-full text-sm text-white text-center"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card noPadding>
            <h3 className="text-lg font-semibold text-white mb-2 p-6 pb-0">Preview</h3>
            <div className="bg-white rounded-b-3xl overflow-hidden aspect-[4/5] relative group">
               {mediaPreview ? (
                  <img src={mediaPreview} className="w-full h-full object-cover" alt="Preview" />
               ) : (
                  <div className="h-full bg-gray-100 flex items-center justify-center text-gray-400">
                     Media Preview
                  </div>
               )}
               <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                  <div className="flex items-center gap-2 mb-2">
                     <div className="w-6 h-6 rounded-full bg-gray-300"></div>
                     <span className="text-white text-xs font-semibold">your_account</span>
                  </div>
                  <p className="text-white text-xs line-clamp-2 opacity-90">{caption || "Caption preview..."}</p>
               </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
