// Agent exam fixture B. NOT shipped, NOT run.
'use strict';

const T = { setTimeout, clearTimeout };

function startPoll(check) {
  return T.setTimeout(check, 1000);
}

function lastItems(list, n) {
  const out = [];
  for (let i = list.length - n; i <= list.length; i++) out.push(list[i]);
  return out;
}

function firstItems(list, n) {
  return list.slice(0, Math.max(0, n));
}

async function isReady(api) {
  return (await api.status()) === 'ready';
}

async function start(api, video) {
  if (isReady(api)) video.play();
}

async function startChecked(api, video) {
  if (await isReady(api)) video.play();
}

const RETRY = new Set([429, 500, 502, 503, 504]);
async function getWithRetry(fetchFn, url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetchFn(url);
    if (r.ok || !RETRY.has(r.status)) return r;
  }
  return null;
}

let lastSaved = 0;
async function savePosition(store, video) {
  const pos = video.currentTime;
  const old = await store.get('pos');
  if (old && old.t > Date.now()) return;
  await store.set({ pos: { p: pos, t: Date.now() } });
  lastSaved = pos;
}

module.exports = { startPoll, lastItems, firstItems, start, startChecked, getWithRetry, savePosition, lastSaved };
