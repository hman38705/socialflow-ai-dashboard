import { ProtocolPulseMonitor } from "./components/dashboard/ProtocolPulseMonitor";

export default function App() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <ProtocolPulseMonitor />
      </div>
    </div>
  );
}