import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';

function fileFor(id) {
  return path.join(config.sessionsDir, `${id}.json`);
}

export async function initSessionStore() {
  await ensureDir(config.sessionsDir);
}

export async function saveSession(session) {
  await writeJson(fileFor(session.id), session);
}

export async function getSession(id) {
  return readJson(fileFor(id), null);
}

export async function listSessions() {
  await ensureDir(config.sessionsDir);
  const files = await fs.readdir(config.sessionsDir);
  const sessions = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const session = await readJson(path.join(config.sessionsDir, file), null);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return sessions;
}
