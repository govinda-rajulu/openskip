# OpenSkip - Universal Video Intro Skipper

🎬 A Firefox extension that automatically detects and skips video intros across all websites.

## ✨ Features

- **Universal Detection** - Works on any website with HTML5 video
- **Smart Skip** - Configurable skip duration (default 60 seconds)
- **Lightweight** - Minimal performance impact
- **Cloud Sync** - Supabase integration for cross-device sync
- **Privacy First** - All data stays under your control

## 📋 Project Structure

```
src/
├── background/      # Service worker
├── content/         # Content scripts (video detection)
├── lib/            # Utilities (Supabase client)
├── providers/      # Platform-specific providers
├── sync/          # Database sync logic
├── ui/            # Vue components
└── utils/         # Helper functions
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Firefox browser

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/govinda-rajulu/openskip.git
   cd openskip
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your Supabase credentials
   ```

4. **Run development:**
   ```bash
   npm run dev
   ```

5. **Load in Firefox:**
   - Go to `about:debugging`
   - Click "This Firefox"
   - Click "Load Temporary Add-on"
   - Select `manifest.json` from the `.firefox` folder

## 🔧 Development

### Build Commands

- `npm run dev` - Start development mode with hot reload
- `npm run build` - Build for all browsers
- `npm run build:firefox` - Build for Firefox only
- `npm run build:chrome` - Build for Chrome
- `npm run zip` - Create distribution packages

### Architecture

#### Content Script (`src/content/index.ts`)
- Scans for HTML5 video elements every 2 seconds
- Injects skip button UI
- Handles skip button click events
- Logs skip events to console

#### Background Script (`src/background/index.ts`)
- Manages extension state
- Handles inter-script communication
- Processes analytics events
- Ready for future Supabase integration

#### Supabase Integration (`src/lib/supabase.ts`)
- Store intro skip times
- Sync user preferences
- Analytics tracking
- Cross-device synchronization

## 📝 Configuration

Create `.env` file with your Supabase credentials:

```env
WXT_SUPABASE_URL=https://your-project.supabase.co
WXT_SUPABASE_ANON_KEY=your-anon-key-here
```

Get these from your [Supabase Dashboard](https://supabase.com/dashboard).

## 🎯 How It Works

1. **Detection** - Content script scans for video elements every 2 seconds
2. **Injection** - Skip button injected with fixed positioning
3. **Skip** - On click, video time advances by 60 seconds
4. **Logging** - Actions logged to browser console
5. **Sync** (future) - Skip history synced to Supabase

## 🚀 Future Enhancements

- 🎬 Platform-specific providers (Netflix, YouTube, Amazon Prime, Disney+)
- 🤖 ML-based intro detection
- 📊 Analytics dashboard
- 🌐 Cross-browser support (Chrome, Edge, Safari)
- 🎨 Custom themes and button styling
- 🔑 User authentication and accounts
- 📱 Mobile companion app

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 💬 Support

For issues, questions, or suggestions, please open an [issue on GitHub](https://github.com/govinda-rajulu/openskip/issues).

---

**Built with** ❤️ using **WXT**, **Vue**, and **Supabase**
