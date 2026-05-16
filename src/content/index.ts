export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const scan = () => {
      const videos = document.querySelectorAll('video')

      videos.forEach((video) => {
        if ((video as any)._openskip) return

        ;(video as any)._openskip = true

        console.log('[OpenSkip] Video detected')

        injectSkipButton(video as HTMLVideoElement)
      })
    }

    setInterval(scan, 2000)
  },
})

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
    Object.assign(button.style, {
      background: '#333',
      transform: 'scale(1.05)',
    })
  }

  button.onmouseout = () => {
    Object.assign(button.style, {
      background: '#111',
      transform: 'scale(1)',
    })
  }

  button.onclick = () => {
    video.currentTime += 60
    console.log(`[OpenSkip] Skipped 60 seconds. New time: ${video.currentTime}s`)
  }

  document.body.appendChild(button)
}
