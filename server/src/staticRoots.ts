import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root whether running from `server/src` or compiled `server/dist`. */
export function resolveRepoRoot(fromUrl = import.meta.url): string {
  const here = path.dirname(fileURLToPath(fromUrl));
  return path.resolve(here, '../..');
}

export interface StaticMount {
  root: string;
  prefix: string;
  /** Serve index.html for this mount's `/` (only the web root). */
  index?: boolean;
}

/** Mounts for the Live Reveal PWA + shared paint modules. */
export function listStaticMounts(repoRoot = resolveRepoRoot()): StaticMount[] {
  const mounts: StaticMount[] = [
    { root: path.join(repoRoot, 'web'), prefix: '/', index: true },
    { root: path.join(repoRoot, 'overlay'), prefix: '/overlay/' },
    { root: path.join(repoRoot, 'background'), prefix: '/background/' },
    { root: path.join(repoRoot, 'shared'), prefix: '/shared/' },
    { root: path.join(repoRoot, 'lib'), prefix: '/lib/' },
  ];
  return mounts.filter((mount) => fs.existsSync(mount.root));
}
