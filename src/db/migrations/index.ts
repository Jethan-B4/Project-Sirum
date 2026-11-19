import { sql as init } from './001_init';
import { sql as formatsAndChapters } from './002_formats_and_chapters';

export type Migration = { version: number; sql: string };

// Append new migrations here with the next version number.
// Never edit a migration that has shipped.
export const migrations: Migration[] = [
  { version: 1, sql: init },
  { version: 2, sql: formatsAndChapters },
];