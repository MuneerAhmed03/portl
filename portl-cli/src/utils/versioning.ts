import type { PortlConfig } from './portlConfig.js';

interface VersionPackageJson {
  version?: string;
}

export interface VersionInfo {
  versionCode: number;
  versionName: string;
}

export function getVersionInfo(
  packageJson: VersionPackageJson,
  config: PortlConfig,
): VersionInfo {
  return {
    versionCode: config.versionCode,
    versionName: packageJson.version ?? '1.0.0',
  };
}
