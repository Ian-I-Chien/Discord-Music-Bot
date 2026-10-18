import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';

export const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
export const AUTH_SCOPES = 'playlist-read-private playlist-read-collaborative';
export const defaultAuthFile = () => process.env.SPOTIFY_AUTH_FILE || '.spotify-auth.json';

export function createSpotifyAuthorization(clientId) {
  if (!/^[a-f0-9]{32}$/i.test(clientId || '')) throw new Error('請提供 Spotify App Client ID。');
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256', code_challenge: challenge, state, scope: AUTH_SCOPES });
  return { verifier, state, url: `https://accounts.spotify.com/authorize?${params}` };
}

export async function saveSpotifyAuthorization(auth, file = defaultAuthFile()) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}`;
  try {
    await writeFile(temporary, JSON.stringify(auth), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function spotifyTokenRequest(body, { fetchImpl = fetch, signal } = {}) {
  const timeout = AbortSignal.timeout(12000);
  const response = await fetchImpl('https://accounts.spotify.com/api/token', {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
  });
  if (!response.ok) throw new Error('Spotify 授權失效，請重新連結 Spotify 帳號。');
  let data;
  try { data = await response.json(); } catch { throw new Error('Spotify 授權回應無效。'); }
  if (typeof data.access_token !== 'string' || !data.access_token || !(data.expires_in > 0)) throw new Error('Spotify 授權回應無效。');
  return data;
}

export function createSpotifyTokenProvider({ file = defaultAuthFile(), fetchImpl = fetch, load = async () => JSON.parse(await readFile(file, 'utf8')), save = auth => saveSpotifyAuthorization(auth, file), now = Date.now } = {}) {
  let auth; let refresh;
  return async function token({ force = false, signal } = {}) {
    signal?.throwIfAborted();
    if (!refresh) refresh = (async () => {
      if (!auth) {
        try { auth = await load(); } catch { throw new Error('Spotify 尚未完成帳號連結。'); }
      }
      if (!/^[a-f0-9]{32}$/i.test(auth.clientId || '') || !auth.refreshToken) throw new Error('Spotify 授權設定無效。');
      if (!force && auth.accessToken && auth.expiresAt > now() + 60000) return auth.accessToken;
      const data = await spotifyTokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: auth.clientId }, { fetchImpl });
      const next = { clientId: auth.clientId, refreshToken: data.refresh_token || auth.refreshToken,
        accessToken: data.access_token, expiresAt: now() + data.expires_in * 1000 };
      await save(next); auth = next;
      return auth.accessToken;
    })().finally(() => { refresh = null; });
    const value = await refresh;
    signal?.throwIfAborted();
    return value;
  };
}
