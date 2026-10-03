# Spiritvale Overlay

A passive, always-on-top combat overlay for **SpiritVale**. It reads your combat
from network traffic and shows live meters on top of the game.

## Overlays

- **Meters!** — damage, healing and damage taken per player, with skill breakdowns
  and a **BOSS** toggle that counts only damage dealt to bosses
- **Gold!** — gold earned this session and gold per hour
- **Kills!** — monsters killed, per type
- **Exp!** — XP gained and XP per hour
- **Pets!** — summon / minion HP bars with buffs
- **Loot!** — item drops you pick up
- **Timer!** — stopwatch with 27 digital styles; pausing it pauses every meter.
  Hover it to switch to a **clock** with your choice of time zone

Every overlay can be moved, resized, scaled, faded, collapsed to a small chip,
or joined into one dock bar. Click-through mode lets you play through them.

## Install

1. Install **[Npcap](https://npcap.com/#download)** and tick
   **"Install Npcap in WinPcap API-compatible Mode"** during setup.
2. Download `Spiritvale-Overlay-Setup-<version>.exe` from the
   [Releases](../../releases) page and run it.
3. Open Spiritvale Overlay, click **Start Overlay**, then play.

> **Windows SmartScreen warning:** the installer is not code-signed, so Windows
> may say "Windows protected your PC". Click **More info → Run anyway**.

## Is it safe to use?

The overlay only **observes**. It never injects into the game, reads or writes
game memory, sends or modifies packets, or automates input. It captures traffic
passively through Npcap, the same way a network monitor does.

## Build from source

Requires [Node.js](https://nodejs.org/) 20+ on Windows.

```powershell
npm install
npm start        # run in development
npm run dist     # build the installer into dist/
```

`npm run build-db` refreshes the bundled game data (`electron/data/core.db`) from
the public wiki and the files in `seed/`.

## Credits

- Packet capture and combat decoding: the
  [`@kar-mi/spirit-vale-tools`](https://www.npmjs.com/search?q=%40kar-mi%2Fspirit-vale-tools)
  libraries (AGPL-3.0)
- Game data and icons: [spiritvalers.com](https://spiritvalers.com/)

This is a fan project and is not affiliated with the developers of SpiritVale.

## License

[AGPL-3.0](LICENSE)
