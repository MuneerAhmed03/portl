export function derivePackageName(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!sanitized) {
    return 'com.portl.app';
  }

  const segment = /^[a-z]/.test(sanitized) ? sanitized : `app${sanitized}`;
  return `com.portl.${segment.slice(0, 54)}`;
}

export function validatePackageName(packageName: string): void {
  if (packageName.length > 64) {
    throw new Error('Android packageName must be 64 characters or fewer.');
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
    throw new Error(
      'Android packageName must use valid Java package segments, for example com.example.app.',
    );
  }
}
