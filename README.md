# Lego Dimensions NFC213 Tag Generator

<p align="center">
  <strong>Open-source web application for generating Lego Dimensions NFC tag codes</strong><br>
  Create custom character and vehicle tags for the discontinued Lego Dimensions game using NFC213 tags.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Express-5.1-000000?logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/NFC-NTAG213-blue" alt="NTAG213">
  <img src="https://img.shields.io/badge/License-Educational-green" alt="License">
</p>

> ⚠️ **Experimental** — This project is intended for testing and educational purposes only. Behaviour may be unstable or change without notice.

A focused command-line application for Lego Dimensions ToyPad interaction on Windows.

This CLI lets you:
- detect tags across all pads,
- read and identify character or vehicle/gadget data,
- write character/vehicle data to a custom tag,
- reset gameplay pages on a custom tag.

## Requirements

- Windows PowerShell (running as Administrator is recommended but not required)
- Node.js 22 or newer
- Lego Dimensions ToyPad connected by USB

  > **Compatible ToyPads only** — only the USB HID toy pads bundled with the following editions are supported:
  > | Platform | Compatible |
  > |----------|-----------|
  > | PlayStation 3 | ✅ |
  > | PlayStation 4 | ✅ |
  > | Wii U | ✅ |
  > | Xbox 360 | ❌ |
  > | Xbox One | ❌ |
  >
  > Xbox toy pads use a proprietary wireless protocol and are **not** compatible with this tool.

## Installation

```powershell
cd lego-dimensions-toypad-cli
npm install
```

## Start the CLI

```powershell
npm start
```

Expected startup output is similar to:

```text
=== ToyPad Interactive Session ===

This keeps the device connection alive and lets you run commands.
No more unplugging! Just keep this running.

Connecting to ToyPad...
✓ Connected!
✅ Device ready! Keep-alive active (pings every 30s)
```

## Core Commands

At the `toypad>` prompt:

- `help` - show command list
- `tags` - show currently detected tags by pad/index
- `rescan` - force a full slot scan (`0..6`)
- `read` - read currently selected tag
- `readall` - read all detected tags
- `readuid` - read UID pages with auto-detected UID comparison
- `write` - guided write flow for a centre-pad custom tag
- `reset` - guided reset flow for centre-pad gameplay pages
- `test`, `pads`, `color`, `off` - LED controls
- `quit` - exit the CLI

## What to Expect from Main Workflows

### 1) Read a tag

```text
toypad> read

🔍 Reading tag data for CENTER [index 0]...
...
✅ CHARACTER IDENTIFIED!
🎮 Name:     The Doctor
🌍 World:    Doctor Who
🆔 ID:       15
```

If a tag is blank/reset, output is similar to:

```text
ℹ️  Tag data not found in known character/vehicle databases
This may be:
	- A blank/unwritten tag
	- A vehicle/gadget with an unknown token ID
	- Custom data written to the tag
```

### 2) Reset a custom tag

`reset` is guided and asks for confirmations.

Expected successful result:

```text
✅ RESET SUCCESSFUL!
	Reset pages: 0x24, 0x25, 0x26
	All reset pages verify as 00000000.
```

Notes:
- If page `0x2B` is already zero and you choose to clear it, the CLI skips that write.
- If gameplay pages reset but `0x2B` has an issue, the CLI reports a partial reset.

### 3) Write character/vehicle data

`write` is guided, validates the tag, then verifies readback on pages `0x24` and `0x25`.

Expected successful result:

```text
✅ WRITE SUCCESSFUL!
	Tag data verified on pages 0x24 and 0x25.
```

Typical example for character ID `15`:

```text
Type to write (`character` or `vehicle`): character
Enter character ID: 15
...
Name:         The Doctor
Page 0x24:    F7E43325
Page 0x25:    B87B5747
```

## Troubleshooting

- Run PowerShell as Administrator (recommended).
- Keep only one ToyPad process running at a time.
- If a tag stops working or does not connect, unplug and plug the ToyPad back in, then restart the CLI.
- If HID becomes unstable, unplug/replug USB and restart the CLI.

## Project Layout

- `interactive.js` - CLI entry point and command routing
- `src/commands/` - command handlers (LED and tag operations)
- `src/core/` - tag state and inventory tracking
- `src/utils/` - shared helpers
- `modern/` - ToyPad transport and crypto helpers
- `data/` - character and token maps

## Credits

### Community contributions
    
   - [**AlinaNova21**](https://github.com/AlinaNova21) — [**node-ld**](https://github.com/AlinaNova21/node-ld) Node.js Lego Dimensions Library
   
   - [**iroteta**](https://pastebin.com/u/iroteta) — Provided [**list_of_characters.json**](https://pastebin.com/YWkX6jaV) and [**list_of_vehicles.json**](https://pastebin.com/NHmWs6gb).

   - [**below**](https://github.com/below) — Reference implementations for ToyPad password mode (0xE1) and blank tag writing via [**DimensionPad**](https://github.com/below/DimensionPad) and [**OutOfSpace**](https://github.com/below/OutOfSpace).

### Graphics & Images
   - [**Jeneric (u/cwbunks)**](https://www.reddit.com/user/cwbunks/) — Created the handmade icon sheet with all character and vehicle images (25mm coin capsule size). [Source thread](https://www.reddit.com/r/Legodimensions/comments/1kxmgzu/handmade_icons_for_every_character_and_vehicle_in/).
   - [**u/legoanimegirl**](https://www.reddit.com/user/legoanimegirl/) — Ripped character sprites from the LDWiki that were used in the icon creation.

### Community Resources & Tutorials
   - [**NFC cloning using iOS**](https://www.reddit.com/r/Legodimensions/comments/kq1dcv/nfc_cloning_using_ios/)
   - [**How to make NFC tags for Lego Dimensions**](https://www.reddit.com/r/Legodimensions/comments/1abb147/how_to_make_nfc_tags_for_lego_dimensions_pc_iphone/)
   - [**How to write Lego Dimensions NFC tags with MiFARE++ Ultralight**](https://www.reddit.com/r/Legodimensions/comments/jlk6ne/comment/gar9tak/?utm_source=reddit&utm_medium=web2x&context=3)
   - **Chteupnin's LD Project Discord** — Community-driven support and development.
      - [**Discord invite**](https://discord.gg/kzsVVYGrW3)
      - [**Chteupnin's LD Generation Website**](https://chteupnin.sp-it.be/)
