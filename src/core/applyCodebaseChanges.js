import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const textHash = (content) => createHash('sha1').update(content || '').digest('hex');

export const applyCodebaseChanges = async ({ root, changes, options = {} }) => {
  const normalizedRoot = path.resolve(root);
  const applied = [];
  const failed = [];
  const backups = [];
  const transactional = Boolean(options.transactional);
  const dryRun = Boolean(options.dryRun);

  for (const change of changes) {
    const filePath = path.resolve(normalizedRoot, change.path);

    if (!filePath.startsWith(normalizedRoot)) {
      failed.push({ path: change.path, reason: '越界路径' });
      if (transactional) break;
      continue;
    }

    try {
      let existed = true;
      let content = null;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch {
        existed = false;
      }

      if (change.expectedHash && textHash(content || '') !== change.expectedHash) {
        failed.push({ path: change.path, reason: '冲突: 文件已变更（hash 不匹配）' });
        if (transactional) break;
        continue;
      }

      backups.push({ path: filePath, existed, content });

      if (!dryRun) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, change.content, 'utf8');
      }
      applied.push(change.path);
    } catch (error) {
      failed.push({ path: change.path, reason: error.message });
      if (transactional) break;
    }
  }

  if (transactional && failed.length > 0 && !dryRun) {
    for (const backup of backups.reverse()) {
      try {
        if (backup.existed) {
          await fs.writeFile(backup.path, backup.content, 'utf8');
        } else {
          await fs.rm(backup.path, { force: true });
        }
      } catch {
        // ignore rollback errors to preserve original failure details
      }
    }

    return { ok: false, applied: [], failed, rolledBack: true, root: normalizedRoot };
  }

  return {
    ok: failed.length === 0,
    applied,
    failed,
    rolledBack: false,
    dryRun,
    root: normalizedRoot
  };
};

export const hashContent = textHash;
