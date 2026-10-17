import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, registerCommands } from '../src/commands.js';
test('global guild-only play command requires link and no application ID configuration', async () => {
  const play = commands.find(c => c.name === 'play');
  assert.deepEqual(play.contexts, [0]);
  assert.equal(play.options[0].name, 'link');
  assert.equal(play.options[0].required, true);
  let registered;
  await registerCommands({ commands: { async set(body) { registered = body; } } });
  assert.equal(registered, commands);
});

test('now-playing command is available in guilds',()=>{assert.deepEqual(commands.find(c=>c.name==='now-playing').contexts,[0]);});
