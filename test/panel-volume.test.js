import test from 'node:test';
import assert from 'node:assert/strict';
import { stepVolume } from '../src/controls.js';
import { panelPayload, syncPanel } from '../src/panel.js';

const session = volume => ({ volume, hasStarted: true, current: { title: 'Song' }, queue: [], player: { state: { status: 'paused' } } });
const buttons = s => panelPayload(s).components.flatMap(row => row.toJSON().components);

test('volume steps apply live, preserve paused playback, and stay within 0–100', () => {
  const s = session(50); const levels = []; const current = s.current;
  s.resource = { volume: { setVolume: value => levels.push(value) } };
  stepVolume(s, -5); assert.equal(s.volume, 45); assert.equal(levels.at(-1), 0.45);
  stepVolume(s, 5); assert.equal(s.volume, 50);
  s.volume = 98; stepVolume(s, 5); stepVolume(s, 5); assert.equal(s.volume, 100);
  s.volume = 2; stepVolume(s, -5); stepVolume(s, -5); assert.equal(s.volume, 0);
  assert.equal(s.current, current); assert.equal(s.player.state.status, 'paused');
  const other = session(50); assert.equal(other.volume, 50);
  const idle = session(undefined); delete idle.current; stepVolume(idle, 5); assert.equal(idle.volume, 55);
  assert.throws(() => stepVolume(s, 10), /無效/);
});

test('panel volume buttons reflect limits and session retirement', () => {
  for (const [volume, down, up] of [[0, true, false], [50, false, false], [100, false, true]]) {
    const s = session(volume); const controls = buttons(s);
    assert.deepEqual(panelPayload(s).components[0].toJSON().components.map(c => c.custom_id), ['music:volume-down', 'music:previous', 'music:toggle-pause', 'music:skip', 'music:volume-up']);
    assert.ok(controls.filter(c => c.custom_id !== 'music:leave').every(c => !/[\u4e00-\u9fff]/u.test(c.label || '')));
    assert.equal(controls.find(c => c.custom_id === 'music:volume-down').disabled, down);
    assert.equal(controls.find(c => c.custom_id === 'music:volume-up').disabled, up);
    assert.equal(new Set(controls.map(c => c.custom_id)).size, controls.length);
    for (const row of panelPayload(s).components) assert.ok(row.toJSON().components.length <= 5);
    s.closed = true;
    assert.ok(buttons(s).every(c => c.disabled));
  }
});

test('rapid volume steps update the same panel and keep the final live volume', async () => {
  const s = session(50); let sends = 0; const edits = [];
  s.text = { send: async () => { sends++; throw new Error('must reuse the existing panel'); } };
  s.panel = { edit: async payload => { edits.push(payload); } };
  stepVolume(s, 5); const work = syncPanel(s);
  stepVolume(s, 5); stepVolume(s, -5); await syncPanel(s); await work;
  assert.equal(s.volume, 55); assert.equal(sends, 0);
  const embed = edits.at(-1).embeds[0].toJSON();
  const volume = embed.fields.at(-1).value;
  assert.match(volume, /55%/);
});
