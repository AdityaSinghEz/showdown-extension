import { describe, expect, it } from 'vitest';
import { compatibleRoles, sampleSet, seededRandom, toId, type SetsData } from '../lib/review/opponent-sets';

const data: SetsData = {
  charizard: {
    level: 85,
    sets: [
      { role: 'Fast Attacker', movepool: ['Earthquake', 'Flamethrower', 'Focus Blast', 'Hurricane', 'Will-O-Wisp'], abilities: ['Blaze'], teraTypes: ['Dragon', 'Fire', 'Ground'] },
      { role: 'Setup Sweeper', movepool: ['Dragon Dance', 'Earthquake', 'Flare Blitz', 'Outrage', 'Swords Dance'], abilities: ['Blaze'], teraTypes: ['Dragon', 'Ground'] },
    ],
  },
  ditto: { sets: [{ role: 'Fast Attacker', movepool: ['Transform'], abilities: ['Imposter'], teraTypes: ['Normal'] }] },
};

const none = { moves: [], ability: null, teraType: null };

describe('toId', () => {
  it('lower-cases and strips punctuation', () => {
    expect(toId('Will-O-Wisp')).toBe('willowisp');
    expect(toId('Giga Drain')).toBe('gigadrain');
  });
});

describe('compatible roles', () => {
  it('keeps every role while nothing is known', () => {
    expect(compatibleRoles('charizard', none, data)).toHaveLength(2);
  });

  it('keeps only roles whose movepool holds every move seen', () => {
    const roles = compatibleRoles('charizard', { ...none, moves: ['swordsdance'] }, data);
    expect(roles.map((r) => r.role)).toEqual(['Setup Sweeper']);
  });

  it('narrows by a Tera type already shown', () => {
    const roles = compatibleRoles('charizard', { ...none, teraType: 'fire' }, data);
    expect(roles.map((r) => r.role)).toEqual(['Fast Attacker']);
  });

  it('falls back to every role when none fits', () => {
    expect(compatibleRoles('charizard', { ...none, moves: ['surf'] }, data)).toHaveLength(2);
  });

  it('returns nothing for a species that is not in the data', () => {
    expect(compatibleRoles('missingno', none, data)).toEqual([]);
  });
});

describe('sampling a set', () => {
  it('always includes the moves that were seen and stays within the role', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const set = sampleSet('charizard', { ...none, moves: ['swordsdance', 'outrage'] }, data, seededRandom(seed));
      expect(set?.role).toBe('Setup Sweeper');
      expect(set?.moves).toHaveLength(4);
      expect(set?.moves.slice(0, 2)).toEqual(['swordsdance', 'outrage']);
      expect(new Set(set?.moves).size).toBe(4);
      expect(['dragon', 'ground']).toContain(set?.teraType);
    }
  });

  it('keeps a seen ability and Tera type', () => {
    const set = sampleSet('charizard', { moves: [], ability: 'blaze', teraType: 'ground' }, data, seededRandom(3));
    expect(set?.ability).toBe('blaze');
    expect(set?.teraType).toBe('ground');
  });

  it('gives the same draw for the same seed and can vary across seeds', () => {
    const a = sampleSet('charizard', none, data, seededRandom(7));
    const b = sampleSet('charizard', none, data, seededRandom(7));
    expect(a).toEqual(b);
    const seen = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(sampleSet('charizard', none, data, seededRandom(i + 1)))));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('uses the whole movepool when it holds fewer than four moves', () => {
    expect(sampleSet('ditto', none, data, seededRandom(1))?.moves).toEqual(['transform']);
  });

  it('returns null for an unknown species', () => {
    expect(sampleSet('missingno', none, data, seededRandom(1))).toBeNull();
  });
});
