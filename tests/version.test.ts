import { describe, expect, it } from 'vitest';
import { simFolderName, versionFromInputLog } from '../lib/replay/version';

const HASH = 'de1cf598c73dfedafff02be52375a62c94ed9ed0';

describe('versionFromInputLog', () => {
  it('reads the build from the first line', () => {
    expect(versionFromInputLog(`>version ${HASH}\n>start {}`)).toEqual({ full: HASH, short: 'de1cf598' });
  });

  it('returns null when the version line is missing or malformed', () => {
    expect(versionFromInputLog(undefined)).toBeNull();
    expect(versionFromInputLog('>start {}')).toBeNull();
    expect(versionFromInputLog('>version abcdef12')).toBeNull();
  });
});

describe('simFolderName', () => {
  it('names the folder after the short hash', () => {
    expect(simFolderName({ short: 'b8f23c99' })).toBe('ps-sim-b8f23c99');
  });
});
