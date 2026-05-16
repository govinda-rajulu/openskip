# Sync Module

Handles syncing user preferences and skip times with Supabase.

## Features

- Store intro skip times per video/user
- Sync preferences across devices
- Backup and restore settings

## Database Schema

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  created_at TIMESTAMP
);

-- Skip history
CREATE TABLE skip_history (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  video_url TEXT,
  skip_time INT,
  created_at TIMESTAMP
);

-- User preferences
CREATE TABLE preferences (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  skip_duration INT DEFAULT 60,
  auto_skip BOOLEAN DEFAULT false,
  created_at TIMESTAMP
);
```

## API Functions

### saveSkipTime

Records when a user skips an intro.

### getPreferences

Retrieves user preferences from the database.

### updatePreferences

Updates user preferences.
