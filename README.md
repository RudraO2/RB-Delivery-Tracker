# RB Delivery Tracker

A Windows app for one party (jewellery business) to track rings sent to its
manufacturer, plus shipment tracking-number checks. There are no logins. All data stays on one computer.

## How it works
- **Paste or type PDF numbers** in the box at the top. Paste a whole Excel column or type one number and press Enter.
  - A preview shows what will happen to each number. **Enter** (or **Save**) applies it.
  - **Auto** (the default):
    - a new number is **sent** to the manufacturer;
    - a number at the manufacturer is marked **received**;
    - a received number is **sent for repair**.
  - **Send** and **Received** limit the box to one action. Received never creates new numbers.
  - The **date** button records something that happened on an earlier day.
- **Tracking number:** the letters before the first digit are ignored, and so are leading zeros.
  - `K-1108`, `KAN 01108` and `1108` are all the same ring (key `1108`).
  - The full label (`K-1108`) is kept for display.
  - If the manufacturer writes only the digits, the number still matches the right ring.
- **Due dates** are counted in calendar days on the computer's clock. You can change both limits in Settings.
  - New: due 6 days after it is sent. It shows "Due today" on that day and turns red from day 7.
  - Repair: due 2 days after it is sent again. It turns red from day 3.
- **Sections:**
  - Today: tiles, plus Late, Due today, Came back today and Sent today.
  - At manufacturer
  - Late
  - Repairs
  - Received (grouped by day)
  - All orders
  - Settings
- Click a row to see its full history. From there you can undo the last step or delete the number. Every save shows an **Undo** toast.

## Data
- File: `%APPDATA%\RB Tracker\rb-tracker-data.json`. It is written atomically (temp file, then rename).
- Daily backups go in `%APPDATA%\RB Tracker\backups\`, and the newest 60 are kept. If the main file is damaged, the app loads the newest good backup and keeps the damaged file aside.
- Uninstalling the app keeps the data.
- Settings has **Export to Excel** (CSV, one row per trip) and **Open data folder**.

## Shipment tracking
- **Shipments** section: import your Excel/CSV of shipped orders (tracking number, name, address, carrier/service, postcode, date). A preview shows warnings before anything is saved.
- The app checks each shipment about every 6 hours while it is open and online (one check at a time, 30 s apart). A failed check retries after 1 hour. Delivered shipments are removed 10 days after delivery unless marked as an open issue.
- Alerts (Settings): pre-transit, no scan, in transit, out for delivery limits. They are review reminders, not delivery promises.
- Engine: `universal-parcel-scraper` run by a bundled `node.exe` (`tracking/worker.mjs`), which uses the Edge or Chrome already on the PC for carriers that need it.
- Carriers that block automatic checks (USPS among them) are looked up through free fallback sources: UPU, ParcelsApp and Ship24. No account or API key is needed.
- Only the tracking number, carrier and postcode leave the computer. They go to the carrier and, when its own site gives no answer, to those fallback sources. Names and addresses are never sent.
- Service names are matched to carriers on import, e.g. `USPS`, `ROYALMAIL`, `AU POST` (Australia Post) and `DRAGONFLY` (Intelcom).
- Data: `%APPDATA%\RB Tracker\shipment-data.json`.

## Develop
```
npm install
npm run setup:tracking     # once: installs the tracking engine into tracking/node_modules (needed for npm run dev checks)
npm run prepare:tracking   # before npm start / dist: also downloads Node 24 for Windows and copies the engine into src-tauri/tracking
npm test                   # unit tests (src/lib/*.test.ts)
npm run test:tracking      # tracking worker tests
npm run typecheck
npm run dev                # browser preview at http://localhost:5173 (uses localStorage; tracking checks run through this computer's Node)
npm start                  # desktop app in dev mode (data in "RB Tracker Dev")
npm run dist               # installer: src-tauri/target/release/bundle/nsis/RB Tracker_<version>_x64-setup.exe
```
- Stack: Tauri 2 (Rust backend in `src-tauri/src/main.rs`), React 19, Vite, Tailwind v4.
- Every ring rule lives in `src/lib/model.ts`, `ids.ts` and `dates.ts` (pure functions). Shipment rules are in `shipments.ts` and `shipment-import.ts`.
- `electron/` and `scripts/shoot.cjs` are the old Electron edition, kept only for screenshots (`npm run icon` also uses Electron).

## Installer notes
- About 46 MB (most of it is the bundled Node runtime for tracking).
- The installer is not code-signed. On first run, Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.
- It installs for the current user only (no admin rights needed). Data from the Electron version is read as is: same folder, same files.

## Not in this repo
- Lock files (`package-lock.json`, `src-tauri/Cargo.lock`), generated `src-tauri/gen/`, and binary icons (`build/icon.png`, `public/icon.png`, `src-tauri/icons/icon.ico`). Run `npm run icon` to regenerate the PNG icons; the `.ico` must be regenerated with `npx tauri icon build/icon.png`.
