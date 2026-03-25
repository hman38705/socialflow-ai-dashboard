import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Activity, Zap, Server, Radio, TrendingUp, AlertCircle } from "lucide-react";

// Type definitions
interface GasFees {
  baseFee: number;
  medianFee: number;
  highFee: number;
  trend: "up" | "down" | "stable";
}

interface ServiceStatus {
  name: string;
  status: "operational" | "degraded" | "down";
  responseTime: number;
  uptime: number;
  lastChecked: Date;
}

interface ProtocolMetrics {
  gasFees: GasFees;
  horizonAPI: ServiceStatus;
  sorobanRPC: ServiceStatus;
  socialAPIs: {
    twitter: ServiceStatus;
    instagram: ServiceStatus;
    tiktok: ServiceStatus;
  };
}

// Mock data generator for realistic metrics
const generateMockMetrics = (): ProtocolMetrics => {
  const variation = () => 0.9 + Math.random() * 0.2; // 90-110% variation
  
  return {
    gasFees: {
      baseFee: Math.round(100 * variation()),
      medianFee: Math.round(500 * variation()),
      highFee: Math.round(1000 * variation()),
      trend: ["up", "down", "stable"][Math.floor(Math.random() * 3)] as "up" | "down" | "stable",
    },
    horizonAPI: {
      name: "Horizon API",
      status: Math.random() > 0.05 ? "operational" : "degraded",
      responseTime: Math.round(50 + Math.random() * 100),
      uptime: 99.9 + Math.random() * 0.09,
      lastChecked: new Date(),
    },
    sorobanRPC: {
      name: "Soroban RPC",
      status: Math.random() > 0.05 ? "operational" : "degraded",
      responseTime: Math.round(80 + Math.random() * 120),
      uptime: 99.8 + Math.random() * 0.19,
      lastChecked: new Date(),
    },
    socialAPIs: {
      twitter: {
        name: "X (Twitter) API",
        status: Math.random() > 0.1 ? "operational" : "degraded",
        responseTime: Math.round(100 + Math.random() * 200),
        uptime: 99.5 + Math.random() * 0.49,
        lastChecked: new Date(),
      },
      instagram: {
        name: "Instagram API",
        status: Math.random() > 0.1 ? "operational" : "degraded",
        responseTime: Math.round(120 + Math.random() * 180),
        uptime: 99.4 + Math.random() * 0.59,
        lastChecked: new Date(),
      },
      tiktok: {
        name: "TikTok API",
        status: Math.random() > 0.1 ? "operational" : "degraded",
        responseTime: Math.round(150 + Math.random() * 200),
        uptime: 99.3 + Math.random() * 0.69,
        lastChecked: new Date(),
      },
    },
  };
};

// Status badge component
const StatusBadge = ({ status }: { status: "operational" | "degraded" | "down" }) => {
  const variants = {
    operational: { color: "bg-green-500", text: "Operational" },
    degraded: { color: "bg-yellow-500", text: "Degraded" },
    down: { color: "bg-red-500", text: "Down" },
  };

  const variant = variants[status];

  return (
    <Badge className="gap-1.5" variant={status === "operational" ? "default" : "destructive"}>
      <span className={`h-2 w-2 rounded-full ${variant.color}`} />
      {variant.text}
    </Badge>
  );
};

// Service status card component
const ServiceStatusCard = ({ service }: { service: ServiceStatus }) => {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{service.name}</span>
        </div>
        <StatusBadge status={service.status} />
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Response Time</p>
          <p className="font-semibold">{service.responseTime}ms</p>
        </div>
        <div>
          <p className="text-muted-foreground">Uptime</p>
          <p className="font-semibold">{service.uptime.toFixed(2)}%</p>
        </div>
      </div>
    </div>
  );
};

export function ProtocolPulseMonitor() {
  const [metrics, setMetrics] = useState<ProtocolMetrics>(generateMockMetrics());
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    // Initial load
    setMetrics(generateMockMetrics());
    setLastUpdate(new Date());

    // Set up 5-second refresh interval
    const intervalId = setInterval(() => {
      setMetrics(generateMockMetrics());
      setLastUpdate(new Date());
    }, 5000);

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Protocol Pulse Monitor
              </CardTitle>
              <CardDescription>
                Real-time network and API health monitoring
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Radio className="h-4 w-4 animate-pulse text-green-500" />
              <span>Live</span>
              <span className="text-xs">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Gas Fees Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              <h3 className="font-semibold">Stellar Network Gas Fees</h3>
              <Badge variant="outline" className="ml-auto">
                {metrics.gasFees.trend === "up" && "↗ Trending Up"}
                {metrics.gasFees.trend === "down" && "↘ Trending Down"}
                {metrics.gasFees.trend === "stable" && "→ Stable"}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Base Fee</p>
                <p className="text-2xl font-bold">{metrics.gasFees.baseFee}</p>
                <p className="text-xs text-muted-foreground">stroops</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Median Fee</p>
                <p className="text-2xl font-bold">{metrics.gasFees.medianFee}</p>
                <p className="text-xs text-muted-foreground">stroops</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">High Priority</p>
                <p className="text-2xl font-bold">{metrics.gasFees.highFee}</p>
                <p className="text-xs text-muted-foreground">stroops</p>
              </div>
            </div>
          </div>

          {/* Stellar Services Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              <h3 className="font-semibold">Stellar Protocol Services</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ServiceStatusCard service={metrics.horizonAPI} />
              <ServiceStatusCard service={metrics.sorobanRPC} />
            </div>
          </div>

          {/* Social Platform APIs Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-purple-500" />
              <h3 className="font-semibold">Social Platform APIs</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ServiceStatusCard service={metrics.socialAPIs.twitter} />
              <ServiceStatusCard service={metrics.socialAPIs.instagram} />
              <ServiceStatusCard service={metrics.socialAPIs.tiktok} />
            </div>
          </div>

          {/* Info Banner */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-4">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>Note:</strong> This monitor displays mock data for demonstration purposes. 
              In production, these metrics would be fetched from real API endpoints and require 
              proper authentication credentials.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
