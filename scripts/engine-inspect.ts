/**
 * Prints what the engine saw and thought at one turn of a game.
 *
 * Usage:
 *   npx tsx scripts/engine-inspect.ts --id <game id> --turn 14
 *   npx tsx scripts/engine-inspect.ts --id <game id> --turn 14 --states data/engine-states-<id>.jsonl --results data/engine-results-<id>.jsonl
 *
 * For both sides it shows the active Pokemon (health, item, ability, boosts, moves),
 * the bench, the field, and then every option the search tried with how often it was
 * chosen and the win chance it led to. It is for checking a grade that looks wrong:
 * compare what is printed here with what you remember of the position.
 */

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { baseMove, type EngineChoiceResult, type EnginePositionResult } from '../lib/review/engine-results';
import type { EngineSide, EngineState } from '../lib/review/engine-state';

interface StateRow {
  id: string;
  turn: number;
  state: EngineState;
  stateP2?: EngineState;
  played: { p1: string | null; p2: string | null };
}

async function readLines<T>(path: string): Promise<T[]> {
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as T);
}

function describeSide(label: string, side: EngineSide): void {
  const active = side.pokemon[side.activeIndex];
  if (!active) return;
  const boosts = Object.entries(side.boosts).filter(([, value]) => value !== 0).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`);
  console.log(`${label}: ${active.id} lvl ${active.level}  ${active.types.filter((t) => t !== 'typeless').join('/')}  hp ${active.hp}/${active.maxhp}${active.status !== 'none' ? `  ${active.status}` : ''}`);
  console.log(`   item ${active.item}, ability ${active.ability}, tera ${active.terastallized ? 'USED' : active.teraType}`);
  console.log(`   boosts ${boosts.length > 0 ? boosts.join(', ') : 'none'}${side.volatileStatuses.length > 0 ? `, volatile ${side.volatileStatuses.join(', ')}` : ''}`);
  console.log(`   moves ${active.moves.map((m) => `${m.id}${m.pp === 0 ? '(no pp)' : ''}${m.disabled ? '(disabled)' : ''}`).join(', ')}`);
  console.log(`   bench ${side.pokemon.filter((_, i) => i !== side.activeIndex).map((p) => `${p.id} ${p.hp}/${p.maxhp}`).join(', ')}`);
  const conditions = Object.entries(side.sideConditions);
  if (conditions.length > 0) console.log(`   side conditions ${conditions.map(([key, value]) => `${key} ${value}`).join(', ')}`);
}

function describeOptions(label: string, options: readonly EngineChoiceResult[], played: string | null): void {
  const merged = new Map<string, { visits: number; score: number }>();
  for (const option of options) {
    const key = baseMove(option.engine);
    const entry = merged.get(key) ?? { visits: 0, score: 0 };
    merged.set(key, { visits: entry.visits + option.visits, score: entry.score + option.score });
  }
  const total = [...merged.values()].reduce((sum, entry) => sum + entry.visits, 0);
  console.log(`${label}  (played: ${played ?? '?'})`);
  for (const [move, entry] of [...merged.entries()].sort((a, b) => b[1].visits - a[1].visits).slice(0, 8)) {
    const share = total === 0 ? 0 : (100 * entry.visits) / total;
    const value = entry.visits === 0 ? 0 : (100 * entry.score) / entry.visits;
    const mark = played !== null && baseMove(played) === move ? '  <- played' : '';
    console.log(`   ${move.padEnd(20)} chosen ${share.toFixed(1).padStart(5)}%   win chance ${value.toFixed(0).padStart(3)}%${mark}`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      turn: { type: 'string' },
      states: { type: 'string' },
      results: { type: 'string' },
    },
  });
  if (values.id === undefined || values.turn === undefined) throw new Error('Pass --id <game id> and --turn <number>');
  const states = await readLines<StateRow>(values.states ?? `data/engine-states-${values.id}.jsonl`);
  const results = await readLines<EnginePositionResult>(values.results ?? `data/engine-results-${values.id}.jsonl`);
  const turn = Number(values.turn);
  const row = states.find((entry) => entry.id === values.id && entry.turn === turn);
  const result = results.find((entry) => entry.id === values.id && entry.turn === turn);
  if (!row || !result) throw new Error(`No position for turn ${turn} of ${values.id}`);
  if (result.error !== undefined) throw new Error(`The search failed for this position: ${result.error}`);

  console.log(`Turn ${turn}\n`);
  describeSide('p1', row.state.sideOne);
  console.log('');
  describeSide('p2', row.state.sideTwo);
  const { weather, terrain, trickRoom } = row.state;
  console.log(`\nfield: weather ${weather}, terrain ${terrain}, trick room ${trickRoom ? 'on' : 'off'}\n`);
  describeOptions('p1 search', result.p1 ?? [], row.played.p1);
  console.log('');
  describeOptions('p2 search', result.p2 ?? [], row.played.p2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
