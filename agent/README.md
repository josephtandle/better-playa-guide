# Burning Man Events Agent 2026

An offline recommendation engine, location intelligence tool, and Telegram bot for Burning Man 2026 ("Axis Mundi"). Designed to work seamlessly on the playa with zero internet connection required.

## What It Does

- **Personalized Recommendations:** Scores and ranks thousands of playa events based on your current location, walk/bike limits, music tastes, tag preferences, and schedule.
- **Polar Geolocation:** Parses Black Rock City clock & street addresses (e.g. `7:30 & E`), calculates distance (in feet), and estimates walking or biking time to any camp or event.
- **Offline First:** Ships with complete 2026 event, camp, and map data built-in. Requires no network access to query recommendations.
- **Telegram Bot Integration:** Run as a local bot for yourself and campmates over offline Wi-Fi or mesh networks.
- **Discovery Scanning:** Scan local chat backup databases for event tips, addresses, and camp recommendations.

## Prebuilt Datasets Included

This package ships preloaded with public 2026 Black Rock City datasets:
- **3,413 Events & 6,566 Occurrences:** Complete event catalog spanning all 8 event days (Aug 30 – Sep 6, 2026).
- **1,187 Theme Camps:** Registered camp index with names and street addresses.
- **BRC 2026 Street Geometry:** Full radial and concentric street map for theme "Axis Mundi" (Esplanade through K / Kundalini).

## Quick Start

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Initialize Your Profile:**
   Copy the example profile directory to create your personal profile:
   ```bash
   cp -r profile.example profile
   ```

3. **Customize Your Settings:**
   Edit `profile/me.yaml` to set your home camp, home address (e.g., `7:30 & E`), music preferences, and tag weights.

4. **Run the CLI:**
   ```bash
   node src/index.js now
   ```

## BRC Address System

Addresses on the playa use clock hours and street names or letters:
- **Format:** `<Clock> & <Street>` (e.g., `7:30 & E` or `3:15 & Esplanade`).
- **Clock Range:** `2:00` to `10:00` in 15-minute increments.
- **Streets:** `Esplanade` (ESP), `A` (Ararat) through `K` (Kundalini).
- **Landmarks:** Key locations like `The Man`, `Center Camp`, and `The Temple` are recognized automatically.

## CLI Command Reference

All output is phone-formatted (≤ 60 columns) for easy reading on mobile terminal apps.

```bash
# Get top recommendations starting or running right now
node src/index.js now --from "7:30 & E"

# Get recommendations for the next 3 hours
node src/index.js next 3

# Filter recommendations by category
node src/index.js food
node src/index.js party
node src/index.js workshops

# Include partner preferences in scoring
node src/index.js now --with-partner

# Geolocate an address and measure distance to The Man
node src/index.js where "9:15 & G"

# Search events by keyword
node src/index.js search "pancakes"

# Inspect specific event details by ID
node src/index.js event 101

# View your must-do schedule, favorites, or friends
node src/index.js mustdo
node src/index.js fav
node src/index.js friend

# Add a favorite or friend location
node src/index.js fav add 101
node src/index.js friend add "Sparky" "3:45 & B"

# Check profile directory and package status
node src/index.js status
node src/index.js setup
```

## Telegram Bot Setup

You can run the agent as an interactive Telegram bot.

1. **Get a Bot Token:**
   Message [@BotFather](https://t.me/BotFather) on Telegram to create a bot and get an API token.

2. **Configure Environment Variables:**
   Set your bot token and allowed Telegram user IDs (comma-separated):
   ```bash
   export BME_BOT_TOKEN="your-bot-token-here"
   export BME_ALLOWED_IDS="12345678,98765432"
   ```

3. **Start the Bot:**
   ```bash
   node -e "require('./src/bot').startBot()"
   ```

## Discovery Sources

You can configure local SQLite message databases (such as exported WhatsApp group chats) in `profile/sources.yaml` to extract event tips automatically:

```yaml
sources:
  - id: "redacted@example.invalid"
    type: "whatsapp_group"
    label: "Camp Chat"
    enabled: true
```

Set the database path via environment variable or in `data/config.json`:
```bash
export BME_WHATSAPP_DB="/path/to/messages.db"
```

## Privacy Notice

> [!IMPORTANT]
> The `profile/` directory holds your personal data, home camp location, friend locations, and custom preferences. If you plan to fork or publish this package, **keep your `profile/` directory out of source control**. Add `profile/` to your `.gitignore`.
