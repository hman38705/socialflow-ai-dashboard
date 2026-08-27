import React from 'react';

export function WebhooksSection(): React.JSX.Element {
  return (
    <div className="max-w-xl space-y-2">
      <h2 className="text-lg font-bold text-white">Webhooks</h2>
      <p className="text-sm text-gray-subtext">
        Outbound webhook management is tracked separately and will land here.
      </p>
    </div>
  );
}

export default WebhooksSection;
