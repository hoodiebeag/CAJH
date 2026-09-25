# Running the data refresh on a schedule

**Draft, not yet in use.** This schedules `scripts/refresh.sh` only — the collection and the push.
It does not schedule `paper`, and must not: where the paper journal lives is an open question (see
the end of this file), and a scheduled `paper` writing to an undecided location would produce the
first evidence-grade record in a place nobody chose.

## What to schedule, and when

```
bash scripts/refresh.sh            # collect + panel + commit + push
```

Once per trading day, after the close. IBKR serves the day's completed daily bar after the session
ends, so a run before the close either misses it or pulls a partial one. 30–60 minutes after the
close is comfortable; the exact minute does not matter because `--skip-fresh` makes a re-run cheap.

**The first run is not the scheduled one.** The initial panel pull across ~1,000 symbols takes
hours, because IBKR paces historical data hard. Run it by hand once, let it finish (it resumes if
interrupted), and only then schedule the daily incremental.

## What has to be true before it works unattended

Each of these is a way a scheduled run fails silently at 4pm on a Tuesday rather than loudly now:

1. **IB Gateway is running and logged in.** It is not a service; it exits on its own schedule and
   after updates, and a logged-out Gateway refuses connections exactly like an absent one. Check
   its auto-restart setting, and expect the run to fail on days it has logged itself out.
2. **The API is enabled** in Gateway: Configure → Settings → API → Enable ActiveX and Socket
   Clients, with 127.0.0.1 trusted. Note the port — 4002 for the paper gateway, 4001 for live.
3. **Node is on the PATH the scheduler uses, which is not your shell's.** cron runs with a minimal
   environment and no login shell, so `node` is routinely not found. Use absolute paths.
4. **`git push` works without a human.** An SSH key with no passphrase, or a credential helper that
   does not prompt. A scheduler cannot answer a password prompt; it hangs or fails.
5. **The checkout is on the right branch.** `refresh.sh` pushes to whatever branch is checked out
   (`git rev-parse --abbrev-ref HEAD`). If the clone sits on `main`, the data lands on `main` and
   the analyst branch never sees it.
6. **Output goes to a file.** A scheduled run with nowhere to write is a run you cannot diagnose.

### A wrapper that makes 3–6 explicit

Save as `~/cajh-refresh.sh`, `chmod +x`, and point the scheduler at this rather than at
`refresh.sh` directly:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="$HOME/CAJH"                 # adjust
BRANCH="main-eqhe6g"              # the branch the analyst work lives on
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"   # where node actually is
cd "$REPO"
git checkout "$BRANCH"
exec bash scripts/refresh.sh
```

Find the right PATH entry with `which node` in your own shell and put that directory first.

## macOS — launchd

Prefer launchd over cron here: cron does not run while the machine is asleep and never catches up,
whereas launchd runs a missed `StartCalendarInterval` job when the machine wakes.

`~/Library/LaunchAgents/com.cajh.refresh.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cajh.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/YOU/cajh-refresh.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>16</integer><key>Minute</key><integer>45</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>16</integer><key>Minute</key><integer>45</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>16</integer><key>Minute</key><integer>45</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>16</integer><key>Minute</key><integer>45</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>16</integer><key>Minute</key><integer>45</integer></dict>
  </array>
  <key>StandardOutPath</key><string>/Users/YOU/cajh-refresh.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/cajh-refresh.err</string>
</dict>
</plist>
```

```
launchctl load  ~/Library/LaunchAgents/com.cajh.refresh.plist
launchctl start com.cajh.refresh      # run it once now to prove the wiring
launchctl unload ~/Library/LaunchAgents/com.cajh.refresh.plist   # to stop
```

The times are **local to the machine**, so this follows the US market only if the machine is on US
Eastern. 16:45 is after a 16:00 ET close; adjust if the machine is elsewhere. launchd does not know
about market holidays — the run will fire and find nothing new, which is harmless.

## Linux — cron or a systemd timer

cron, weekdays at 16:45 local:

```
45 16 * * 1-5 /bin/bash /home/YOU/cajh-refresh.sh >> /home/YOU/cajh-refresh.log 2>&1
```

A systemd user timer is better if the machine sleeps, because `Persistent=true` catches up:

`~/.config/systemd/user/cajh-refresh.service`
```ini
[Unit]
Description=CAJH data refresh
[Service]
Type=oneshot
ExecStart=/bin/bash /home/YOU/cajh-refresh.sh
```

`~/.config/systemd/user/cajh-refresh.timer`
```ini
[Unit]
Description=CAJH data refresh, weekdays after the close
[Timer]
OnCalendar=Mon..Fri 16:45
Persistent=true
[Install]
WantedBy=timers.target
```

```
systemctl --user daemon-reload
systemctl --user enable --now cajh-refresh.timer
systemctl --user start cajh-refresh.service    # prove it now
journalctl --user -u cajh-refresh -n 50        # read the output
loginctl enable-linger $USER                   # so it runs while logged out
```

## Windows — Task Scheduler

With Git for Windows installed, run the wrapper through its bash:

```
schtasks /create /tn "CAJH refresh" /sc weekly /d MON,TUE,WED,THU,FRI /st 16:45 ^
  /tr "\"C:\Program Files\Git\bin\bash.exe\" -lc \"~/cajh-refresh.sh\"" ^
  /rl LIMITED /f
```

In the GUI, set "Run whether user is logged on or not" only if the credential store still works
without an interactive session — otherwise the push fails. Test with `schtasks /run /tn "CAJH
refresh"` before trusting it.

## Proving it before trusting it

A scheduler that silently does nothing looks exactly like a market holiday. After the first
scheduled run:

```
git log --oneline -3                 # is there a "data refresh <timestamp>" commit?
git log origin/main-eqhe6g -1        # did it reach the REMOTE, not just the local clone?
```

The second command is the one that matters. `refresh.sh` used to report success while pushing
nothing, which is why it now has a test that asserts on the remote rather than on its own output.

## What is deliberately NOT scheduled

`node analyst-run.mjs paper` — and by extension `settle` and `score`:

- **A scheduled `paper` run must not be the first one.** Run it by hand, read what it did, and
  check `node analyst-run.mjs protocol` before handing it to a timer.

Where the journal lives is now settled, and the answer matters for scheduling: it is
`analyst-journal.jsonl` at the repository root, resolved absolutely so the directory a scheduler
happens to start in cannot fork the record, and tracked in git so it survives the machine. Override
with `CAJH_JOURNAL` if you want it elsewhere. **One machine should append to it** — two both
appending produce a merge conflict in an append-only file.

`refresh.sh` stages and pushes the journal along with the data, so scheduling the refresh on the
same machine that runs `paper` also backs the record up. Scheduling them on different machines does
not, and splits the journal.

No scheduler in this file places an order of any kind. The hard limits in README.md are unchanged
by it, and this document deliberately does not restate them — they have one home.
