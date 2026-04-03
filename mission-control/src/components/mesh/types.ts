export interface TailscalePeer {
  nodeId: string;
  ip: string;
  online: boolean;
  latencyMs: number | null;
  relay: boolean;
}

export interface NodeHealth {
  nodeId: string;
  platform: string;
  role: string;
  tailscaleIp: string;
  diskPercent: number;
  mem: { total: number; free: number };
  uptimeSeconds: number;
  cpuLoadPercent?: number;
  services: Array<{ name: string; status: string; pid?: number }>;
  agent: {
    status: string;
    currentTask: string | null;
    llm: string | null;
    model: string | null;
    budgetRemainingSeconds?: number;
  };
  capabilities: string[];
  stats: {
    tasksToday: number;
    successRate: number;
    tokenSpendTodayUsd: number;
  };
  tailscale?: {
    peers: TailscalePeer[];
    selfIp: string;
    natType: string;
  };
  nats?: {
    serverUrl: string;
    connected: boolean;
    serverVersion: string;
    isHost: boolean;
  };
  deployVersion?: string;
  reportedAt?: string;
}

export interface ActiveTask {
  id: string;
  title: string;
  status: string;
  meshTaskId: string | null;
}

export interface MeshNode {
  nodeId: string;
  status: "online" | "degraded" | "offline";
  health: NodeHealth | null;
  activeTasks: ActiveTask[];
  lastSeen: string | null;
  staleSeconds: number | null;
  tailscale: NodeHealth["tailscale"] | null;
  nats: NodeHealth["nats"] | null;
  cpuLoadPercent: number | null;
  isNatsHost: boolean;
  peerConnectivity: "all_direct" | "some_relay" | "degraded" | "unknown";
}

export interface MeshEvent {
  event: string;
  task_id: string;
  task?: Record<string, unknown>;
  timestamp: string;
}
