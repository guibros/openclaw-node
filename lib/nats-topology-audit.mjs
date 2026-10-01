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
    if (!routez?.server_id || !jsz?.server_id || routez.server_id !== jsz.server_id
        || !Array.isArray(routez.routes)) return { port, error: 'incomplete or mismatched monitor responses' };
    return {
      port,
      serverId: routez.server_id,
      routeIds: [...new Set(routez.routes.map((route) => route.remote_id).filter(Boolean))].sort(),
      cluster: jsz.meta_cluster?.name || null,
      leader: jsz.meta_cluster?.leader || null,
      streams: jsz.streams,
      consumers: jsz.consumers,
    };
  });
  return { classification: classifyNatsTopology(members), members };
}

export async function observeNatsTopology(fetchJson) {
  const responses = await Promise.all(PORTS.map(async (port) => {
    try {
      const [routez, jsz] = await Promise.all([
        fetchJson(`http://127.0.0.1:${port}/routez`),
        fetchJson(`http://127.0.0.1:${port}/jsz`),
      ]);
      return { routez, jsz };
    } catch (error) {
      return { error: error.message };
    }
  }));
  return summarizeNatsTopology(responses);
}
