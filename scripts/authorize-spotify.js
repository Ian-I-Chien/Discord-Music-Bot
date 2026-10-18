import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSpotifyAuthorization, saveSpotifyAuthorization, spotifyTokenRequest, REDIRECT_URI, defaultAuthFile } from '../src/spotify-auth.js';

const clientId = process.argv[2];
const auth = createSpotifyAuthorization(clientId);
const file = resolve(defaultAuthFile());
let busy = false;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, REDIRECT_URI);
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET' || url.pathname !== '/callback') { response.writeHead(404).end('Not found'); return; }
  if (busy || url.searchParams.get('state') !== auth.state) { response.writeHead(400).end('Invalid authorization state.'); return; }
  if (url.searchParams.has('error') || !url.searchParams.get('code')) { response.writeHead(400).end('Authorization cancelled. You may close this tab.'); shutdown(); return; }
  busy = true;
  try {
    const data = await spotifyTokenRequest({ grant_type: 'authorization_code', client_id: clientId,
      code: url.searchParams.get('code'), redirect_uri: REDIRECT_URI, code_verifier: auth.verifier });
    if (!data.refresh_token) throw new Error('Spotify did not return refresh authorization.');
    await saveSpotifyAuthorization({ clientId, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 }, file);
    response.end('Spotify connected. You can close this tab.');
    console.log(`Spotify authorization saved to ${file}. Tokens were not printed.`);
  } catch {
    response.writeHead(500).end('Authorization failed. Please retry from the terminal.');
    process.exitCode = 1;
  } finally { shutdown(); }
});
const timeout = setTimeout(() => { console.error('Spotify authorization timed out. Run the command again.'); process.exitCode = 1; shutdown(); }, 300000);
function shutdown() { clearTimeout(timeout); server.close(); }
server.on('error', () => { console.error('Unable to open the local Spotify callback on port 8888.'); process.exitCode = 1; shutdown(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
server.listen(8888, '127.0.0.1', () => console.log(`Open this URL in your browser to connect Spotify:\n${auth.url}`));
