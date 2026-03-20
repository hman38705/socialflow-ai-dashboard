import React, { useState } from 'react';
import { Card } from './ui/Card';
import { Conversation, Platform, ViewProps } from '../types';
import { generateReply } from '../services/geminiService';
import { SiInstagram, SiFacebook } from 'react-icons/si';
import { FaXTwitter } from 'react-icons/fa6';

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const initialConversations: Conversation[] = [
  {
    id: '1',
    platform: 'instagram',
    user: 'Sarah Jenkins',
    avatar: 'https://picsum.photos/100/100?random=1',
    lastMessage: 'Hey! I love the new product. When is it restocking?',
    unread: true,
    status: 'new',
    messages: [
       { id: 'm1', sender: 'Sarah Jenkins', avatar: 'https://picsum.photos/100/100?random=1', text: 'Hey! I love the new product. When is it restocking?', timestamp: '10:30 AM', isMe: false }
    ]
  },
  {
    id: '2',
    platform: 'facebook',
    user: 'Mike Ross',
    avatar: 'https://picsum.photos/100/100?random=2',
    lastMessage: 'I have an issue with my order #12345.',
    unread: false,
    status: 'pending',
    messages: [
       { id: 'm1', sender: 'Mike Ross', avatar: 'https://picsum.photos/100/100?random=2', text: 'Hi, I need help.', timestamp: 'Yesterday', isMe: false },
       { id: 'm2', sender: 'Me', avatar: '', text: 'Hello Mike, what seems to be the problem?', timestamp: 'Yesterday', isMe: true },
       { id: 'm3', sender: 'Mike Ross', avatar: 'https://picsum.photos/100/100?random=2', text: 'I have an issue with my order #12345.', timestamp: '9:00 AM', isMe: false }
    ]
  }
];

export const Inbox: React.FC<ViewProps> = () => {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string>(initialConversations[0].id);
  const [replyText, setReplyText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedConversation = conversations.find(c => c.id === selectedId);

  const handleAiSuggest = async () => {
    if (!selectedConversation) return;
    setLoadingSuggestions(true);
    
    const history = selectedConversation.messages.map(m => `${m.sender}: ${m.text}`).join('\n');
    const replies = await generateReply(history);
    
    setSuggestions(replies);
    setLoadingSuggestions(false);
  };

  const applySuggestion = (text: string) => {
    setReplyText(text);
    setSuggestions([]);
  };

  const handleSend = () => {
      if (!replyText.trim() || !selectedConversation) return;
      
      const newMessage = {
          id: Date.now().toString(),
          sender: 'Me',
          avatar: '',
          text: replyText,
          timestamp: 'Just now',
          isMe: true
      };

      const updatedConversations = conversations.map(c => {
          if (c.id === selectedId) {
              return {
                  ...c,
                  lastMessage: 'You: ' + replyText,
                  messages: [...c.messages, newMessage],
                  status: 'resolved' as const
              };
          }
          return c;
      });

      setConversations(updatedConversations);
      setReplyText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
      }
  };
  
  const updateConversationStatus = (id: string, status: 'new' | 'pending' | 'resolved') => {
      setConversations(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  }

  const filteredConversations = conversations.filter(c => 
     c.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
     c.lastMessage.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-full animate-fade-in">
      {/* List */}
      <div className="w-80 border-r border-dark-border bg-dark-bg flex flex-col">
         <div className="p-6 border-b border-dark-border">
            <h2 className="text-lg font-bold text-white mb-4">Inbox</h2>
            <div className="relative">
               <MaterialIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-subtext" />
               <input 
                 type="text" 
                 placeholder="Search messages..." 
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 className="w-full bg-dark-surface border border-dark-border rounded-2xl py-2.5 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-primary-blue placeholder:text-gray-subtext"
               />
            </div>
         </div>
         <div className="flex-1 overflow-y-auto">
            {filteredConversations.map(conv => (
               <div 
                 key={conv.id} 
                 onClick={() => setSelectedId(conv.id)}
                 className={`p-4 border-b border-dark-border cursor-pointer hover:bg-white/5 transition-colors ${selectedId === conv.id ? 'bg-primary-blue/5' : ''}`}
               >
                  <div className="flex justify-between items-start mb-1">
                     <div className="flex items-center gap-2">
                        {conv.platform === 'instagram' && <SiInstagram size={14} className="text-pink-500" />}
                        {conv.platform === 'facebook' && <SiFacebook size={14} className="text-primary-blue" />}
                        {conv.platform === 'x' && <FaXTwitter size={14} className="text-black" />}
                        <span className={`text-sm font-semibold ${conv.unread ? 'text-white' : 'text-gray-subtext'}`}>{conv.user}</span>
                     </div>
                     <span className="text-[10px] text-gray-subtext">10m</span>
                  </div>
                  <p className={`text-xs line-clamp-1 ${conv.unread ? 'text-white font-medium' : 'text-gray-subtext'}`}>{conv.lastMessage}</p>
                  <div className="mt-2 flex gap-2">
                     {conv.status === 'new' && <span className="text-[10px] bg-primary-blue/20 text-primary-blue px-2 py-0.5 rounded-full flex items-center gap-1"><MaterialIcon name="check_circle" className="text-sm" /> New</span>}
                     {conv.status === 'pending' && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full flex items-center gap-1"><MaterialIcon name="schedule" className="text-sm" /> Pending</span>}
                     {conv.status === 'resolved' && <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full flex items-center gap-1"><MaterialIcon name="check_circle" className="text-sm" /> Resolved</span>}
                  </div>
               </div>
            ))}
         </div>
      </div>

      {/* Chat Area */}
      {selectedConversation ? (
        <div className="flex-1 flex flex-col bg-dark-surface/30">
           {/* Header */}
           <div className="h-16 border-b border-dark-border flex items-center justify-between px-6 bg-dark-surface/50 backdrop-blur-md">
              <div className="flex items-center gap-3">
                 <img src={selectedConversation.avatar} className="w-8 h-8 rounded-full" />
                 <div>
                    <h3 className="text-sm font-semibold text-white">{selectedConversation.user}</h3>
                    <p className="text-xs text-gray-subtext">via {selectedConversation.platform}</p>
                 </div>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => console.log("Marked as important")} className="p-2 text-gray-subtext hover:text-white"><MaterialIcon name="error" /></button>
                 <button onClick={() => updateConversationStatus(selectedConversation.id, 'resolved')} className="p-2 text-gray-subtext hover:text-white"><MaterialIcon name="check_circle" /></button>
              </div>
           </div>

           {/* Messages */}
           <div className="flex-1 p-6 overflow-y-auto space-y-4">
              {selectedConversation.messages.map(msg => (
                 <div key={msg.id} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] rounded-2xl p-4 ${msg.isMe ? 'bg-primary-blue text-white rounded-br-sm' : 'bg-dark-surface border border-dark-border text-white rounded-bl-sm'}`}>
                       <p className="text-sm">{msg.text}</p>
                       <p className={`text-[10px] mt-1 text-right ${msg.isMe ? 'text-blue-200' : 'text-gray-subtext'}`}>{msg.timestamp}</p>
                    </div>
                 </div>
              ))}
           </div>

           {/* Input Area */}
           <div className="p-6 border-t border-dark-border bg-dark-surface/50">
              {/* AI Suggestions */}
              {suggestions.length > 0 && (
                 <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
                    {suggestions.map((s, i) => (
                       <button 
                         key={i} 
                         onClick={() => applySuggestion(s)}
                         className="flex-shrink-0 bg-primary-teal/10 border border-primary-teal/20 hover:bg-primary-teal/20 text-primary-teal text-xs px-3 py-2 rounded-2xl transition-colors text-left max-w-xs truncate"
                       >
                          ✨ {s}
                       </button>
                    ))}
                 </div>
              )}
              
              <div className="relative">
                 <textarea 
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-dark-bg border border-dark-border rounded-2xl p-4 pr-12 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary-blue/50 resize-none h-24"
                    placeholder="Type a message..."
                 />
                 <div className="absolute bottom-3 right-3 flex items-center gap-2">
                    <button className="p-2 text-gray-subtext hover:text-white" onClick={() => console.log("Attaching file...")}><MaterialIcon name="attach_file" /></button>
                    <button 
                      onClick={handleAiSuggest}
                      disabled={loadingSuggestions}
                      className={`p-2 ${loadingSuggestions ? 'text-primary-teal/60' : 'text-primary-teal'} hover:text-primary-teal/70`} 
                      title="AI Reply Suggestion"
                    >
                       <MaterialIcon name="auto_awesome" className={loadingSuggestions ? "animate-pulse" : ""} />
                    </button>
                    <button 
                      onClick={handleSend}
                      disabled={!replyText.trim()}
                      className="p-2 bg-primary-blue text-white rounded-2xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                       <MaterialIcon name="send" />
                    </button>
                 </div>
              </div>
           </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-subtext">
           Select a conversation
        </div>
      )}
    </div>
  );
};