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
    name?: string;
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
    dnsName?: string;
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

// Peers arrive in two shapes: the KV-published TailscalePeer contract
// (nodeId/latencyMs) and the local-fallback blob from /api/mesh/nodes
// (hostname/os/lastSeen). This view type covers both.
export interface PeerView {
  online?: boolean;
  hostname?: string;
  ip?: string;
  os?: string;
  direct?: boolean;
  relay?: boolean | string | null;
  latency?: { latencyMs?: number } | null;
  latencyMs?: number | null;
  lastSeen?: string | null;
}

export interface MeshStatus {
  natsConnected: boolean;
  natsUrl: string;
  localNodeId: string;
  nodesOnline: number;
  nodesTotal: number;
}

export interface MeshEvent {
  event: string;
  task_id: string;
  task?: Record<string, unknown>;
  timestamp: string;
}
