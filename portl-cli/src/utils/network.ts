import os from 'node:os';

const PREFERRED_INTERFACES = ['en0', 'eth0', 'wlan0'];
const EXCLUDED_INTERFACE_HINTS = [
  'docker',
  'br-',
  'veth',
  'vmnet',
  'tailscale',
  'tun',
  'tap',
  'vpn',
];

export function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  const candidates: Array<{ name: string; address: string }> = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      if (entry.family === 'IPv4' && entry.internal === false) {
        candidates.push({ name, address: entry.address });
      }
    }
  }

  if (candidates.length === 0) {
    console.warn('⚠️  Could not detect a local IPv4 address. Falling back to localhost.');
    return 'localhost';
  }

  const preferred = candidates.find((candidate) => PREFERRED_INTERFACES.includes(candidate.name));
  if (preferred) {
    return preferred.address;
  }

  const nonExcluded = candidates.find(
    (candidate) =>
      !EXCLUDED_INTERFACE_HINTS.some((hint) => candidate.name.toLowerCase().includes(hint)),
  );

  return (nonExcluded ?? candidates[0]).address;
}
