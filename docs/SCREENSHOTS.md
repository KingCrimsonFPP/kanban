# Capturing README screenshots

This guide is for the human taking the screenshots the README links to. It
covers running the demo board and capturing each of the six images the
README references under `docs/images/`.

## Run the demo board

1. From the repo root, run:
   ```
   node skills/web/scripts/server.js examples/demo-board
   ```
2. Open the printed `http://localhost:7777` URL in a desktop browser (Chrome
   or Edge; VSCode's Simple Browser also works).
3. Maximize the window — aim for roughly 1680x1050 — so every screenshot is
   framed consistently.

## Shot checklist

Save every file at the exact name below into `docs/images/` — the README
links to these paths verbatim.

| File | View | Required? | How to reach it | What the frame should show |
| --- | --- | --- | --- | --- |
| `docs/images/board.png` | Board | Required | The default view when the app loads. | The columns (backlog/todo/doing/done) with the demo cards; a High-priority card, a waiting card (amber left accent + "Waiting on" badge), a blocked card (red pill), and an epic card (orange dot) all visible. |
| `docs/images/map.png` | Dependency map | Required | Click "🕸 Map view" in the top bar. | The `waiting_for` dependency graph — the waiting_for chain and the epic node (orange) as the sink below its children. |
| `docs/images/gantt.png` | Gantt | Required | Click "📊 Gantt" in the top bar. | Working-range bars and amber due-date diamonds, grouped by status. |
| `docs/images/calendar.png` | Calendar (month) | Required | Click "📅 Calendar" in the top bar. | The Monday-start month grid with range chips and a due-date (⚑) chip. |
| `docs/images/card-detail.png` | Card detail popup | Optional | Click any card tile on the board. | The detail popup: fields, dates, tags, "Last modified". |
| `docs/images/viewer.png` | Mobile tap editor | Optional | Generate with `python skills/viewer/scripts/build_editor.py examples/demo-board --out editor.html` and open `editor.html` on a phone (or a narrow browser window). | The single-file HTML board with the fixed scroll-button stack; a card detail sheet open. |

`board.png` may already exist as an auto-captured starter image — feel free
to retake it if the framing needs work. The other five are captured by hand.

## After you have the images

Drop the PNGs into `docs/images/` using the exact filenames from the table
above, then tell Claude "screenshots are in" — Claude will verify them and
close #148.

## Framing tips

- Use the app's default (dark) theme.
- Crop to the app content — no browser chrome, taskbar, or desktop
  background.
- Keep each image reasonably sized (a few hundred KB, not multi-MB) so the
  repo stays light.
