// Agent exam fixture A. NOT shipped, NOT run. Planted problems are listed only in
// ANSWERS.json, which the seats never see. Some code here is correct on purpose.
'use strict';

const ALLOWED_HOSTS = ['www.youtube.com', 'm.youtube.com'];

function isYouTube(url) {
  return String(url).includes('youtube.com');
}

function isYouTubeStrict(url) {
  try { return ALLOWED_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}

function showTitle(box, pageTitle) {
  box.innerHTML = '<b>Now playing:</b> ' + pageTitle;
}

function showTitleSafe(box, pageTitle) {
  const b = document.createElement('b');
  b.textContent = 'Now playing: ';
  box.replaceChildren(b, document.createTextNode(pageTitle));
}

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SEEK') {
    document.querySelector('video').currentTime = Number(e.data.t);
  }
});

window.addEventListener('message', (e) => {
  if (e.source !== window.parent || e.origin !== location.origin) return;
  if (e.data && e.data.type === 'PING') e.source.postMessage({ type: 'PONG' }, e.origin);
});

async function sendToken(baseUrl, token) {
  return fetch('https://' + baseUrl + '/api/v1/subtitles', { headers: { Authorization: 'Bearer ' + token } });
}

module.exports = { isYouTube, isYouTubeStrict, showTitle, showTitleSafe, sendToken };
