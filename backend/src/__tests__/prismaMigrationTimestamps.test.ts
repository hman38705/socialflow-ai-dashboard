import fs from 'fs';
import path from 'path';

describe('prisma migrations', () => {
  it('has no two migration folders sharing a timestamp prefix', () => {
    const dir = path.join(__dirname, '../../prisma/migrations');
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const m = entry.isDirectory() && /^(\d{14})_/.exec(entry.name);
      if (!m) continue;
      if (seen.has(m[1])) dups.push(`${seen.get(m[1])} <-> ${entry.name}`);
      else seen.set(m[1], entry.name);
    }
    expect(dups).toEqual([]);
  });
});
