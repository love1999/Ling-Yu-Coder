import { createErrorResponse, createOkResponse, validateEnvelope } from './protocol.js';

export class MemoryModule {
  constructor(api) {
    this.name = 'Memory Module';
    this.api = api;
  }

  async loadRaw() {
    return this.api.loadMemory();
  }

  pruneNotes(notes, options = {}) {
    const ttlDays = options.ttlDays ?? 30;
    const maxNotes = options.maxNotes ?? 200;
    const now = Date.now();
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

    const alive = [];
    const archived = [];

    for (const note of notes) {
      if (now - (note.ts || now) <= ttlMs) {
        alive.push(note);
      } else {
        archived.push(note);
      }
    }

    return {
      alive: alive.slice(-maxNotes),
      archived
    };
  }

  trimArchive(archive, options = {}) {
    const maxArchive = options.maxArchive ?? 500;
    return archive.slice(-maxArchive);
  }

  async remember(entry, options = {}) {
    const current = await this.loadRaw();
    const notes = [...(current.notes || []), { ...entry, ts: Date.now() }];
    const { alive, archived } = this.pruneNotes(notes, options);

    const archive = this.trimArchive([...(current.archive || []), ...archived], options);

    const next = {
      ...current,
      notes: alive,
      archive
    };

    await this.api.saveMemory(next);
    return {
      next,
      archivedCount: archived.length
    };
  }

  async run(envelope) {
    const start = Date.now();
    try {
      validateEnvelope(envelope);
      const { next, archivedCount } = await this.remember(
        envelope.payload.entry || {},
        envelope.payload.options || {}
      );

      return createOkResponse(envelope, {
        noteCount: (next.notes || []).length,
        archiveCount: (next.archive || []).length,
        archivedInThisRun: archivedCount,
        latest: (next.notes || []).slice(-1)[0] || null
      }, Date.now() - start);
    } catch (error) {
      return createErrorResponse(envelope, error, Date.now() - start);
    }
  }
}
