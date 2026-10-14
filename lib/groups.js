// Groups votes that look like the same person: votes that share a device or a network
// (directly or through each other) end up in one group, and each group is one entry in the draw.
// Votes you've cleared at /management always count as their own group.
export function groupVotes(votes) {
  const parent = new Map(votes.map((v) => [v.id, v.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (const key of ['device', 'ip_hash']) {
    const first = new Map();
    for (const v of votes) {
      if (v.cleared || !v[key]) continue;
      if (first.has(v[key])) union(first.get(v[key]), v.id);
      else first.set(v[key], v.id);
    }
  }
  const groups = new Map();
  for (const v of votes) groups.set(v.id, find(v.id));
  return groups; // vote id → group id (the lowest vote id in the group)
}

// Why each vote is flagged, ignoring whether it was cleared.
export function flagReasons(votes) {
  const count = (key) => {
    const m = new Map();
    for (const v of votes) if (v[key]) m.set(v[key], (m.get(v[key]) || 0) + 1);
    return m;
  };
  const dev = count('device'), net = count('ip_hash');
  const out = new Map();
  for (const v of votes) {
    out.set(v.id, {
      same_device: !!v.device && dev.get(v.device) > 1,
      same_network: !!v.ip_hash && net.get(v.ip_hash) > 1,
    });
  }
  return out;
}

export function randomInt(n) {
  // Unbiased random integer in [0, n)
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= max);
  return buf[0] % n;
}
