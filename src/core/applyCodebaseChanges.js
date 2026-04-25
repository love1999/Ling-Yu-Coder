import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const textHash = (content) => createHash('sha1').update(content || '').digest('hex');

const jsLikeExt = new Set(['.js', '.mjs', '.cjs']);

const validateSyntaxIfNeeded = ({ filePath, content, strategy }) => {
  if (strategy !== 'patch-ast') {
    return { ok: true };
  }

  const ext = path.extname(filePath);
  if (!jsLikeExt.has(ext)) {
    return { ok: true };
  }

  try {
    new vm.Script(content || '');
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `syntax check failed: ${error.message}` };
  }
};

const threeWayLineMerge = ({ base, current, incoming }) => {
  const baseLines = (base || '').split('\n');
  const currentLines = (current || '').split('\n');
  const incomingLines = (incoming || '').split('\n');
  const max = Math.max(baseLines.length, currentLines.length, incomingLines.length);

  const merged = [];
  let hasConflict = false;

  for (let i = 0; i < max; i += 1) {
    const b = baseLines[i] ?? '';
    const c = currentLines[i] ?? '';
    const n = incomingLines[i] ?? '';

    if (c === n) {
      merged.push(c);
      continue;
    }

    if (c === b) {
      merged.push(n);
      continue;
    }

    if (n === b) {
      merged.push(c);
      continue;
    }

    hasConflict = true;
    merged.push('<<<<<<< CURRENT');
    merged.push(c);
    merged.push('=======');
    merged.push(n);
    merged.push('>>>>>>> INCOMING');
  }

  return {
    mergedContent: merged.join('\n'),
    hasConflict
  };
};

const tryPatchMerge = ({ filePath, currentContent, incomingContent, change, options }) => {
  const strategy = options.mergeStrategy;
  if (strategy !== 'patch' && strategy !== 'patch-ast') {
    return { merged: false, reason: 'merge strategy disabled' };
  }

  if (typeof change.baseContent !== 'string') {
    return { merged: false, reason: 'missing baseContent for patch merge' };
  }

  const mergeResult = threeWayLineMerge({
    base: change.baseContent,
    current: currentContent || '',
    incoming: incomingContent || ''
  });

  if (mergeResult.hasConflict && !options.allowConflictMarkers) {
    return { merged: false, reason: 'patch merge conflict' };
  }

  const syntaxCheck = validateSyntaxIfNeeded({
    filePath,
    content: mergeResult.mergedContent,
    strategy
  });

  if (!syntaxCheck.ok) {
    return { merged: false, reason: syntaxCheck.reason };
  }

  return {
    merged: true,
    mergedContent: mergeResult.mergedContent,
    hasConflict: mergeResult.hasConflict,
    strategy
  };
};

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

      backups.push({ path: filePath, existed, content });

      let nextContent = change.content;
      let merged = false;
      let mergeConflict = false;
      let mergeStrategy = null;

      if (change.expectedHash && textHash(content || '') !== change.expectedHash) {
        const patchMerge = tryPatchMerge({
          filePath,
          currentContent: content || '',
          incomingContent: change.content,
          change,
          options
        });

        if (!patchMerge.merged) {
          failed.push({ path: change.path, reason: `冲突: 文件已变更（hash 不匹配），${patchMerge.reason}` });
          if (transactional) break;
          continue;
        }

        nextContent = patchMerge.mergedContent;
        merged = true;
        mergeConflict = Boolean(patchMerge.hasConflict);
        mergeStrategy = patchMerge.strategy;
      }

      if (!dryRun) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, nextContent, 'utf8');
      }

      applied.push({
        path: change.path,
        merged,
        mergeConflict,
        mergeStrategy
      });
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
export const mergePatchContent = threeWayLineMerge;
export const syntaxAwareMergeGuard = validateSyntaxIfNeeded;
