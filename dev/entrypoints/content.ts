// src/content/index.ts
import { defineContentScript } from 'wxt'
import { supabase } from '../lib/supabase.js'

let userId: string | null = null

async function getUserId() {
  let id = localStorage.getItem('openskip_user')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('openskip_user', id)
  }
  return id
}

export default defineContentScript({
  matches: ['<all_urls>'],
  async main() {
    userId = await getUserId()
    setInterval(scanVideos, 2000)
  },
})

function scanVideos() {
  const videos = document.querySelectorAll('video')
  videos.forEach((video) => {
    const customVideo = video as any
    if (customVideo._openskip) return
    customVideo._openskip = true

    attachTracker(video)
    injectSkipButton(video)
  })
}

function attachTracker(video: HTMLVideoElement) {
  let lastSaved = 0
  setInterval(async () => {
    if (!video.duration || video.paused) return
    const now = video.currentTime
    if (Math.abs(now - lastSaved) < 5) return
    lastSaved = now

    await supabase.from('playback_states').upsert({
      user_id: userId,
      media_id: getMediaId(),
      playback_time: now,
      duration: video.duration,
      site: location.hostname,
      updated_at: new Date().toISOString(),
    })
  }, 5000)

  restore(video)
}

async function restore(video: HTMLVideoElement) {
  const { data } = await supabase
    .from('playback_states')
    .select('*')
    .eq('media_id', getMediaId())
    .maybeSingle()

  if (data?.playback_time) {
    setTimeout(() => {
      video.currentTime = data.playback_time
    }, 1000)
  }
}

function getMediaId() {
  return location.hostname + location.pathname
}

function injectSkipButton(video: HTMLVideoElement) {
  const button = document.createElement('button')
  button.innerText = 'Skip Intro'
  Object.assign(button.style, {
    position: 'fixed',
    bottom: '80px',
    right: '20px',
    zIndex: '999999',
    padding: '12px 24px',
    background: '#111',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    transition: 'all 0.3s ease',
  })

  button.onmouseover = () => {
    Object.assign(button.style, { background: '#333', transform: 'scale(1.05)' })
  }
  button.onmouseout = () => {
    Object.assign(button.style, { background: '#111', transform: 'scale(1)' })
  }
  button.onclick = () => {
    video.currentTime += 60
    console.log(`[OpenSkip] Skipped 60 seconds. New time: ${video.currentTime}s`)
  }

  document.body.appendChild(button)
}