import React, { useState, useRef, useEffect } from 'react';
import { Card } from './ui/Card';
import { ViewProps } from '../types';

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const initialMediaItems = [
  { id: 1, type: 'image', url: 'https://picsum.photos/300/300', name: 'Campaign_01.jpg' },
  { id: 2, type: 'image', url: 'https://picsum.photos/300/400', name: 'Product_Shot.jpg' },
  { id: 3, type: 'video', url: 'https://picsum.photos/300/200', name: 'Teaser_Reel.mp4' },
  { id: 4, type: 'image', url: 'https://picsum.photos/300/300?random=1', name: 'Lifestyle_02.jpg' },
  { id: 5, type: 'image', url: 'https://picsum.photos/300/500', name: 'Infographic_v2.png' },
  { id: 6, type: 'image', url: 'https://picsum.photos/300/250', name: 'Banner_Xmas.jpg' },
];

export const MediaLibrary: React.FC<ViewProps> = () => {
  const [mediaItems, setMediaItems] = useState(initialMediaItems);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [selectedFolder, setSelectedFolder] = useState('All Media');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useOutsideAlerter(menuRef, () => setOpenMenuId(null));

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const newItem = {
            id: Date.now(),
            type: file.type.startsWith('video') ? 'video' : 'image',
            url: URL.createObjectURL(file),
            name: file.name
        };
        setMediaItems([newItem, ...mediaItems]);
    }
  };
  
  const deleteItem = (id: number) => {
      setMediaItems(prev => prev.filter(item => item.id !== id));
      setOpenMenuId(null);
  }

  const filteredItems = mediaItems.filter(item => filter === 'all' || item.type === filter);

  return (
    <div className="p-7 h-full flex flex-col animate-fade-in">
      <div className="flex justify-between items-center mb-7">
         <h2 className="text-2xl font-bold text-white">Media Library</h2>
         <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} accept="image/*,video/*" multiple />
         <button 
           onClick={() => fileInputRef.current?.click()}
           className="flex items-center gap-2 bg-primary-blue hover:bg-blue-700 text-white px-4 py-2 rounded-2xl transition-colors shadow-lg shadow-blue-500/20"
         >
            <MaterialIcon name="upload_file" />
            <span className="text-sm font-medium">Upload New</span>
         </button>
      </div>

      <div className="flex h-full gap-8">
        {/* Folders Sidebar */}
        <div className="w-64 flex-shrink-0 space-y-4">
           <Card className="p-4 space-y-2">
              <h3 className="text-xs font-bold text-gray-subtext uppercase mb-3">Folders</h3>
              {['All Media', 'Campaigns', 'Product Shots', 'User Generated', 'Archived'].map((folder) => (
                 <button 
                    key={folder} 
                    onClick={() => setSelectedFolder(folder)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedFolder === folder ? 'bg-primary-blue/10 text-primary-blue' : 'text-gray-subtext hover:bg-white/5 hover:text-white'}`}
                 >
                    <MaterialIcon name="folder" className={selectedFolder === folder ? "fill-primary-blue/20" : ""} />
                    {folder}
                 </button>
              ))}
           </Card>

           <Card className="p-4">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="text-xs font-bold text-gray-subtext uppercase">Storage</h3>
                 <button onClick={() => alert('Navigating to upgrade page...')} className="text-xs text-primary-blue hover:text-blue-300">Upgrade</button>
              </div>
              <div className="w-full h-2 bg-dark-surface rounded-full mb-2">
                 <div className="w-[75%] h-full bg-gradient-to-r from-primary-blue to-primary-teal rounded-full"></div>
              </div>
              <p className="text-xs text-gray-subtext">7.5 GB of 10 GB used</p>
           </Card>
        </div>

        {/* Grid */}
        <div className="flex-1">
           <div className="flex justify-between items-center mb-6">
              <div className="flex gap-2">
                 <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-2xl text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white/10 text-white' : 'text-gray-subtext hover:bg-white/5'}`}>All</button>
                 <button onClick={() => setFilter('image')} className={`px-3 py-1.5 rounded-2xl text-xs font-medium transition-colors ${filter === 'image' ? 'bg-white/10 text-white' : 'text-gray-subtext hover:bg-white/5'}`}>Images</button>
                 <button onClick={() => setFilter('video')} className={`px-3 py-1.5 rounded-2xl text-xs font-medium transition-colors ${filter === 'video' ? 'bg-white/10 text-white' : 'text-gray-subtext hover:bg-white/5'}`}>Videos</button>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => setLayout('grid')} className={`p-2 transition-colors ${layout === 'grid' ? 'text-white' : 'text-gray-subtext hover:text-white'}`}><MaterialIcon name="grid_view" /></button>
                 <button onClick={() => setLayout('list')} className={`p-2 transition-colors ${layout === 'list' ? 'text-white' : 'text-gray-subtext hover:text-white'}`}><MaterialIcon name="view_list" /></button>
              </div>
           </div>

           {layout === 'grid' ? (
               <div className="columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6">
                  {filteredItems.map((item) => (
                     <div key={item.id} className="relative group break-inside-avoid cursor-pointer">
                        <img 
                          src={item.url} 
                          alt={item.name} 
                          className="w-full rounded-2xl border border-dark-border group-hover:border-primary-blue/50 transition-colors"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex flex-col justify-end p-4">
                           <p className="text-white text-sm font-medium truncate">{item.name}</p>
                           <div className="flex justify-between items-center mt-2">
                              <span className="text-xs text-gray-subtext uppercase">{item.type}</span>
                              <div className="relative" ref={menuRef}>
                                <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(item.id); }} className="p-1 hover:bg-white/20 rounded-full text-white">
                                    <MaterialIcon name="more_vert" />
                                </button>
                                {openMenuId === item.id && (
                                    <div className="absolute top-full right-0 mt-1 w-36 bg-dark-surface border border-dark-border rounded-2xl shadow-lg z-20 animate-fade-in-sm">
                                        <button onClick={() => alert('Editing name...')} className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-white/5"><MaterialIcon name="edit" className="text-sm" /> Rename</button>
                                        <a href={item.url} download={item.name} onClick={() => setOpenMenuId(null)} className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-white/5"><MaterialIcon name="download" className="text-sm" /> Download</a>
                                        <div className="h-px bg-dark-border my-1"></div>
                                        <button onClick={() => deleteItem(item.id)} className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-400/10"><MaterialIcon name="delete" className="text-sm" /> Delete</button>
                                    </div>
                                )}
                              </div>
                           </div>
                        </div>
                     </div>
                  ))}
               </div>
           ) : (
               <div className="space-y-2">
                   {filteredItems.map((item) => (
                       <div key={item.id} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 transition-colors border border-transparent hover:border-dark-border cursor-pointer">
                           <img src={item.url} className="w-12 h-12 rounded-lg object-cover" />
                           <div className="flex-1">
                               <p className="text-sm font-medium text-white">{item.name}</p>
                               <p className="text-xs text-gray-subtext uppercase">{item.type}</p>
                           </div>
                            <div className="relative" ref={menuRef}>
                               <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(item.id); }} className="p-2 text-gray-subtext hover:text-white"><MaterialIcon name="more_vert" /></button>
                               {openMenuId === item.id && (
                                    <div className="absolute top-full right-0 mt-1 w-36 bg-dark-surface border border-dark-border rounded-2xl shadow-lg z-20 animate-fade-in-sm">
                                        <button onClick={() => alert('Editing name...')} className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-white/5"><MaterialIcon name="edit" className="text-sm" /> Rename</button>
                                        <a href={item.url} download={item.name} onClick={() => setOpenMenuId(null)} className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-white/5"><MaterialIcon name="download" className="text-sm" /> Download</a>
                                        <div className="h-px bg-dark-border my-1"></div>
                                        <button onClick={() => deleteItem(item.id)} className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-400/10"><MaterialIcon name="delete" className="text-sm" /> Delete</button>
                                    </div>
                                )}
                            </div>
                       </div>
                   ))}
               </div>
           )}
           
           {filteredItems.length === 0 && (
                <div className="text-center py-20 text-gray-subtext">
                    No media found for this filter.
                </div>
           )}
        </div>
      </div>
    </div>
  );
};