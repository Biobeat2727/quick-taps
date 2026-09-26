// Stable anonymous id for this device (Ably clientId before joining a table,
// presence, challenge inbox). crypto.randomUUID only exists on secure pages —
// plain http over the LAN (phone testing) doesn't have it — so fall back to
// getRandomValues.

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function getBrowserId(): string {
  let id = localStorage.getItem('qt:browserId');
  if (!id) {
    id = uuid();
    localStorage.setItem('qt:browserId', id);
  }
  return id;
}
