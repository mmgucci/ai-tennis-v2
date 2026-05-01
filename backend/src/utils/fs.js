import fs from 'node:fs/promises';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
