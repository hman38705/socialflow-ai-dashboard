import React from 'react';

export function ScheduleSection(): React.JSX.Element {
  return (
    <div className="max-w-xl space-y-2">
      <h2 className="text-lg font-bold text-white">Schedule</h2>
      <p className="text-sm text-gray-subtext">
        Posting schedule preferences are tracked separately and will land here.
      </p>
    </div>
  );
}

export default ScheduleSection;
