import { describe, expect, it } from 'vitest';
import { collectReveals } from '../lib/review/reveals';

const log = [
  '|switch|p1a: Hitmontop|Hitmontop, L88, M|231/231',
  '|switch|p2a: Swampert|Swampert, L82, M|298/298',
  '|-ability|p1a: Hitmontop|Intimidate|boost',
  '|move|p2a: Swampert|Yawn|p1a: Hitmontop',
  '|move|p1a: Hitmontop|Triple Axel|p2a: Swampert',
  '|-heal|p2a: Swampert|255/298|[from] item: Leftovers',
  '|move|p2a: Swampert|Earthquake|p1a: Hitmontop',
  '|move|p2a: Swampert|Struggle|p1a: Hitmontop',
  '|move|p2a: Swampert|Hydro Pump|p1a: Hitmontop|[from]Sleep Talk',
  '|-terastallize|p2a: Swampert|Water',
  '|switch|p2a: Noctowl|Noctowl, L84, F|344/344',
];

describe('what each side has seen', () => {
  const reveals = collectReveals(log);

  it('lists every Pokemon that has appeared, by species', () => {
    expect([...reveals.p2.keys()]).toEqual(['swampert', 'noctowl']);
    expect([...reveals.p1.keys()]).toEqual(['hitmontop']);
  });

  it('records the moves a Pokemon used, once each, in order', () => {
    expect(reveals.p2.get('swampert')?.moves).toEqual(['yawn', 'earthquake']);
    expect(reveals.p1.get('hitmontop')?.moves).toEqual(['tripleaxel']);
  });

  it('ignores Struggle and moves called by another move', () => {
    expect(reveals.p2.get('swampert')?.moves).not.toContain('struggle');
    expect(reveals.p2.get('swampert')?.moves).not.toContain('hydropump');
  });

  it('records an ability that was shown, an item that did something visible and a Tera type', () => {
    expect(reveals.p1.get('hitmontop')?.ability).toBe('intimidate');
    expect(reveals.p2.get('swampert')?.item).toBe('leftovers');
    expect(reveals.p2.get('swampert')?.teraType).toBe('water');
  });

  it('leaves unshown information empty', () => {
    expect(reveals.p2.get('swampert')?.ability).toBeNull();
    expect(reveals.p2.get('noctowl')).toEqual({ moves: [], ability: null, item: null, teraType: null });
  });

  it('reads only the public line of a split', () => {
    const split = collectReveals([
      '|switch|p2a: Swampert|Swampert, L82|298/298',
      '|split|p2',
      '|move|p2a: Swampert|Secret Move|p1a: X',
      '|move|p2a: Swampert|Earthquake|p1a: X',
    ]);
    expect(split.p2.get('swampert')?.moves).toEqual(['earthquake']);
  });

  it('credits an item shown through another Pokemon with [of]', () => {
    const of = collectReveals([
      '|switch|p2a: Swampert|Swampert, L82|298/298',
      '|switch|p1a: Hitmontop|Hitmontop, L88|231/231',
      '|-damage|p1a: Hitmontop|200/231|[from] item: Rocky Helmet|[of] p2a: Swampert',
    ]);
    expect(of.p2.get('swampert')?.item).toBe('rockyhelmet');
  });
});
