import { describe, expect, it } from 'vitest';
import { BattleTracker } from '../lib/battle/state';
import { decisionTable } from '../lib/battle/summary';
import { parseHp, parsePokemonId, speciesFromDetails } from '../lib/battle/turns';
import { message, ROOM, SAMPLE_BATTLE } from './fixtures';

function track(...messages: string[]) {
  const tracker = new BattleTracker();
  for (const raw of messages) tracker.ingest(raw);
  const state = tracker.get(ROOM);
  if (!state) throw new Error('battle was not tracked');
  return state;
}

describe('turn recording', () => {
  it('opens one record per turn plus a lead record', () => {
    const state = track(SAMPLE_BATTLE);
    expect(state.turns.map((t) => t.turn)).toEqual([0, 1, 2, 3, 4]);
  });

  it('records the leads as switches in turn 0', () => {
    const lead = track(SAMPLE_BATTLE).turns[0];
    expect(lead?.actions.map((a) => [a.side, a.kind, a.pokemon])).toEqual([
      ['p1', 'switch', 'Zoroark'],
      ['p2', 'switch', 'Hydrapple'],
    ]);
  });

  it('records moves with species and targets', () => {
    const turn1 = track(SAMPLE_BATTLE).turns[1];
    expect(turn1?.actions).toHaveLength(2);
    expect(turn1?.actions[0]).toMatchObject({
      kind: 'move',
      side: 'p1',
      pokemon: 'Zoroark',
      move: 'Dark Pulse',
      target: 'Hydrapple',
      viaEffect: null,
    });
  });

  it('records damage with before and after HP fractions', () => {
    const turn1 = track(SAMPLE_BATTLE).turns[1];
    expect(turn1?.damage[0]).toMatchObject({ side: 'p2', pokemon: 'Hydrapple', before: 1, after: 0.65 });
    expect(turn1?.damage[1]?.after).toBeCloseTo(150 / 310);
  });

  it('records a voluntary switch with the Pokemon it replaced', () => {
    const turn2 = track(SAMPLE_BATTLE).turns[2];
    expect(turn2?.actions[0]).toMatchObject({
      kind: 'switch',
      side: 'p1',
      pokemon: 'Gengar',
      switchedFrom: 'Zoroark',
    });
  });

  it('attaches a Tera type to the move that follows it', () => {
    const turn2 = track(SAMPLE_BATTLE).turns[2];
    const move = turn2?.actions.find((a) => a.kind === 'move');
    expect(move).toMatchObject({ move: 'Draco Meteor', tera: 'Dragon' });
  });

  it('records faints and marks the next switch as a replacement', () => {
    const turn3 = track(SAMPLE_BATTLE).turns[3];
    expect(turn3?.faints).toEqual([{ side: 'p2', pokemon: 'Hydrapple' }]);
    const replacement = turn3?.actions.find((a) => a.kind === 'replacement');
    expect(replacement).toMatchObject({ side: 'p2', pokemon: 'Kingambit', switchedFrom: null });
  });

  it('records chance events', () => {
    const state = track(SAMPLE_BATTLE);
    expect(state.turns[1]?.luck).toEqual([
      { kind: 'crit', side: 'p1', pokemon: 'Zoroark', detail: null },
    ]);
    expect(state.turns[2]?.luck).toEqual([
      { kind: 'miss', side: 'p2', pokemon: 'Hydrapple', detail: 'Gengar' },
    ]);
    expect(state.turns[4]?.luck).toEqual([
      { kind: 'cant', side: 'p2', pokemon: 'Kingambit', detail: 'par' },
    ]);
  });

  it('captures the board state when a turn closes', () => {
    const state = track(SAMPLE_BATTLE);
    const end1 = state.turns[1]?.endState;
    expect(end1?.p2.active?.species).toBe('Hydrapple');
    expect(end1?.p2.active?.hp).toBe(0.65);
    expect(end1?.p1.remaining).toBe(6);

    const end3 = state.turns[3]?.endState;
    expect(end3?.p2.remaining).toBe(5);
    expect(end3?.p2.active?.species).toBe('Kingambit');
  });

  it('closes the final turn when the battle ends', () => {
    const last = track(SAMPLE_BATTLE).turns[4];
    expect(last?.endState?.p2.active?.hp).toBe(0.4);
    expect(last?.endState?.p2.active?.status).toBeNull();
  });

  it('does not treat effect-caused moves as decisions or consume Tera', () => {
    const state = track(
      message(
        '|switch|p1a: Zoroark|Zoroark, L82, M|100/100',
        '|switch|p2a: Hydrapple|Hydrapple, L84, F|100/100',
        '|turn|1',
        '|-terastallize|p1a: Zoroark|Dark',
        '|move|p1a: Zoroark|Swords Dance||[from]ability: Dancer',
        '|move|p1a: Zoroark|Dark Pulse|p2a: Hydrapple',
      ),
    );
    const [dancer, real] = state.turns[1]?.actions ?? [];
    expect(dancer).toMatchObject({ viaEffect: 'ability: Dancer', tera: null });
    expect(real).toMatchObject({ viaEffect: null, tera: 'Dark' });
  });

  it('ignores events for non-singles positions', () => {
    const state = track(message('|switch|p1b: Zoroark|Zoroark, L82|100/100', '|turn|1'));
    expect(state.turns[0]?.actions).toHaveLength(0);
  });

  it('resets a room when the server replays its log', () => {
    const tracker = new BattleTracker();
    tracker.ingest(SAMPLE_BATTLE);
    tracker.ingest(message('|init|battle', ...SAMPLE_BATTLE.split('\n').slice(1)));
    const state = tracker.get(ROOM);
    expect(state?.turns).toHaveLength(5);
    expect(state?.turns[1]?.actions).toHaveLength(2);
  });

  it('keeps raw protocol lines for each turn', () => {
    const turn1 = track(SAMPLE_BATTLE).turns[1];
    expect(turn1?.log[0]).toBe('|turn|1');
    expect(turn1?.log).toContain('|-crit|p1a: Zoroark');
  });
});

describe('decisionTable', () => {
  it('lists the leads and each turn without effect-caused actions', () => {
    const rows = decisionTable(track(SAMPLE_BATTLE));
    expect(rows[0]).toEqual({
      turn: 0,
      p1: 'Zoroark: switch to Zoroark',
      p2: 'Hydrapple: switch to Hydrapple',
    });
    expect(rows[1]).toEqual({
      turn: 1,
      p1: 'Zoroark: Dark Pulse',
      p2: 'Hydrapple: Earth Power',
    });
    expect(rows[2]?.p2).toBe('Hydrapple: Draco Meteor (Tera Dragon)');
    expect(rows[3]?.p2).toBe('Kingambit: send out Kingambit');
  });
});

describe('parsers', () => {
  it('parses Pokemon identifiers', () => {
    expect(parsePokemonId('p1a: Zoroark')).toEqual({ side: 'p1', position: 'a', name: 'Zoroark' });
    expect(parsePokemonId('p2: Gengar')).toEqual({ side: 'p2', position: null, name: 'Gengar' });
    expect(parsePokemonId('nonsense')).toBeNull();
    expect(parsePokemonId(undefined)).toBeNull();
  });

  it('parses HP fields', () => {
    expect(parseHp('65/100')).toEqual({ fraction: 0.65, status: null, fainted: false });
    expect(parseHp('50/200 par')).toEqual({ fraction: 0.25, status: 'par', fainted: false });
    expect(parseHp('0 fnt')).toEqual({ fraction: 0, status: null, fainted: true });
    expect(parseHp('abc')).toBeNull();
    expect(parseHp(undefined)).toBeNull();
  });

  it('extracts the species from details', () => {
    expect(speciesFromDetails('Zoroark-Hisui, L82, M')).toBe('Zoroark-Hisui');
    expect(speciesFromDetails('Gengar')).toBe('Gengar');
    expect(speciesFromDetails(undefined)).toBeNull();
  });
});
