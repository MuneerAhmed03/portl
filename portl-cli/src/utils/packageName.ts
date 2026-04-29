export function derivePackageName(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!sanitized) {
    return 'com.portl.app';
  }

  return `com.portl.${sanitized}`;
}
