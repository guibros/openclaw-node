const PORTS = [8222, 8223, 8224];

export function classifyNatsTopology(members) {
  if (members.length !== PORTS.length || members.some((m) => m.error || !m.serverId)) return 'unobservable';
  const ids = members.map((m) => m.serverId);
  if (new Set(ids).size !== ids.length) return 'unobservable';
  const routes = members.map((m) => new Set(m.routeIds));
  const [first, second, third] = members;
  if (members.every((m, i) => m.cluster && routes[i].size === 2
      && ids.every((id, j) => i === j || routes[i].has(id)))
      && new Set(members.map((m) => m.cluster)).size === 1) return 'three-member-cluster';
  if (!first.cluster && routes[0].size === 0
      && second.cluster && second.cluster === third.cluster
      && routes[1].size === 1 && routes[1].has(third.serverId)
      && routes[2].size === 1 && routes[2].has(second.serverId)) return 'standalone-plus-two';
  return 'other';
}

export function summarizeNatsTopology(responses) {
  const members = PORTS.map((port, index) => {
    const item = responses[index];
    if (item?.error) return { port, error: item.error };
    const routez = item?.routez;
    const jsz = item?.jsz;
    const varz = item?.varz;
    if (!routez?.server_id || !jsz?.server_id || !varz?.server_id || !varz.server_name
        || routez.server_id !== jsz.server_id || routez.server_id !== varz.server_id
        || varz.port !== port - 4000
        || !Array.isArray(routez.routes)) return { port, error: 'incomplete or mismatched monitor responses' };
    const meta = jsz.meta_cluster;
    return {
      port,
      clientPort: varz.port,
      serverId: routez.server_id,
      serverName: varz.server_name,
      routeIds: [...new Set(routez.routes.map((route) => route.remote_id).filter(Boolean))].sort(),
      cluster: meta?.name || null,
      leader: meta?.leader || null,
      clusterSize: Number.isInteger(meta?.cluster_size) ? meta.cluster_size : null,
      replicas: Array.isArray(meta?.replicas) ? meta.replicas.map((replica) => ({
        name: replica.name,
        offline: typeof replica.offline === 'boolean' ? replica.offline : null,
        current: typeof replica.current === 'boolean' ? replica.current : null,
      })) : [],
      streams: jsz.streams,
      consumers: jsz.consumers,
    };
  });
  return { classification: classifyNatsTopology(members), members };
}

export async function observeNatsTopology(fetchJson) {
  const responses = await Promise.all(PORTS.map(async (port) => {
    try {
      const [routez, jsz, varz] = await Promise.all([
        fetchJson(`http://127.0.0.1:${port}/routez`),
        fetchJson(`http://127.0.0.1:${port}/jsz`),
        fetchJson(`http://127.0.0.1:${port}/varz`),
      ]);
      return { routez, jsz, varz };
    } catch (error) {
      return { error: error.message };
    }
  }));
  return summarizeNatsTopology(responses);
}
