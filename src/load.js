// Reads a plugin or a standalone skill from disk into memory. Every file is read whole: a scanner
// that stopped after a few thousand characters was beaten by putting the payload further down,
// so nothing here samples, truncates or skips quietly. What is not read is listed, with why.
import fs from 'node:fs/promises';
import path from 'node:path';

// Folders that are counted but not read: git's own data, and installed dependencies (thousands of
// files that belong to other projects). Both are reported, so a reader knows they exist.
const SKIP_DIRS = new Set(['.git', 'node_modules']);
// A file this large is reported instead of read. It is not silently dropped: the report says so.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * @typedef {object} LoadedFile
 * @property {string} rel        path from the target root, always with forward slashes
 * @property {number} size       bytes on disk
 * @property {string|null} text  the content, or null for binary, oversized and linked files
 * @property {boolean} binary
 * @property {string} [link]     where a symbolic link points, when the file is one
 * @property {boolean} [tooLarge]
 *
 * @typedef {object} Target
 * @property {string} root                 absolute path
 * @property {Map<string, LoadedFile>} files
 * @property {{rel: string, reason: string, count?: number}[]} skipped
 */

/** @returns {Promise<Target>} */
export async function loadTarget(dir) {
  const root = path.resolve(dir);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat) throw new Error(`Not found: ${dir}`);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${dir} (point plugvet at the plugin or skill folder)`);
  const files = new Map();
  const skipped = [];
  await walk(root, '', files, skipped);
  return { root, files, skipped };
}

async function walk(root, relDir, files, skipped) {
  const entries = await fs.readdir(path.join(root, relDir), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const abs = path.join(root, rel);
    if (entry.isSymbolicLink()) {
      // Never followed: a link can point anywhere on the machine (~/.ssh), and what it points at
      // is not part of the plugin. It is reported instead.
      const link = await fs.readlink(abs).catch(() => '?');
      files.set(rel, { rel, size: 0, text: null, binary: false, link });
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        skipped.push({ rel, reason: entry.name === '.git' ? 'git data' : 'installed dependencies', count: await countFiles(abs) });
        continue;
      }
      await walk(root, rel, files, skipped);
      continue;
    }
    if (!entry.isFile()) continue;
    const { size } = await fs.stat(abs);
    if (size > MAX_FILE_BYTES) {
      files.set(rel, { rel, size, text: null, binary: false, tooLarge: true });
      skipped.push({ rel, reason: `larger than ${MAX_FILE_BYTES / 1024 / 1024} MB` });
      continue;
    }
    const bytes = await fs.readFile(abs);
    const binary = isBinary(bytes);
    files.set(rel, { rel, size, binary, text: binary ? null : decode(bytes) });
  }
}

async function countFiles(abs) {
  let n = 0;
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(dir, e.name));
      else n++;
    }
  }
  return n;
}

// A NUL byte in the first 8 KB is the usual sign of a binary file (git uses the same test).
function isBinary(bytes) {
  const end = Math.min(bytes.length, 8192);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

// UTF-8 with a leading byte-order mark dropped: an editor's BOM is not hidden text.
function decode(bytes) {
  const text = bytes.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
