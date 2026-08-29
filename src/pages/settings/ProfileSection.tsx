import React, { useState } from 'react';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';

export function ProfileSection(): React.JSX.Element {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(true);

  useUnsavedChanges(!saved);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white">Profile</h2>
        <p className="text-sm text-gray-subtext">Basic account details.</p>
      </div>

      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
          Display name
        </span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          placeholder="Your name"
          className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
        />
      </label>

      <button
        onClick={() => setSaved(true)}
        disabled={saved}
        className="px-6 py-2.5 rounded-xl bg-primary-blue text-white text-sm font-bold disabled:opacity-40"
      >
        Save changes
      </button>
    </div>
  );
}

export default ProfileSection;
