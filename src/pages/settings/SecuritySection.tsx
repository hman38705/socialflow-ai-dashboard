import React from 'react';

export function SecuritySection(): React.JSX.Element {
  return (
    <div className="max-w-xl space-y-2">
      <h2 className="text-lg font-bold text-white">Security</h2>
      <p className="text-sm text-gray-subtext">
        Password rotation and two-factor authentication are tracked separately and will land here.
      </p>
    </div>
  );
}

export default SecuritySection;
