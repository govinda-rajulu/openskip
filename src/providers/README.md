# Platform Providers

This directory contains platform-specific implementations for detecting and handling intros on different video platforms.

## Supported Platforms

- [ ] Netflix
- [ ] YouTube
- [ ] Amazon Prime Video
- [ ] Disney+
- [ ] Hulu
- [ ] Twitch

## Creating a Provider

Each provider should implement:

```typescript
export interface VideoProvider {
  name: string
  detect(): HTMLVideoElement | null
  getIntroEnd(): number
}
```

## Example Provider

```typescript
// netflix.ts
export const netflixProvider = {
  name: 'Netflix',
  detect() {
    return document.querySelector('video')
  },
  getIntroEnd() {
    // Query Netflix API or DOM for intro end time
    return 90 // 90 seconds
  }
}
```
