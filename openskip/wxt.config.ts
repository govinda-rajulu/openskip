import { defineConfig } from 'wxt'

export default defineConfig({
  manifest: {
    name: 'OpenSkip',
    version: '0.0.1',
    manifest_version: 3,
    description: 'Skip intros and save playback progress across devices',
    icons: {
      16: 'icon/16.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    permissions: ['storage', 'tabs', 'activeTab', 'scripting'],
    background: {
      service_worker: 'background.js',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content-scripts/index.js'], // <-- built file
      },
    ],
  },
  targets: ['firefox-mv3'], // this will build for Firefox
  entrypointsDir: 'src/content',   // <-- use this, not 'entrypoints'
})