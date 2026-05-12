# RecordAndReplay

You are learning a real user workflow (or replaying one) instead of rediscovering it via reads and acts. Use this when:
- The user just demonstrated something and you need to repeat it programmatically
- A workflow is complex enough that learning by observation beats step-by-step interaction
- You need a replay plan to hand off to another agent or save for regression testing

## Record

1. **Start the session.** Optionally include an instruction so the export carries the user's intent.
   ```bash
   interceptor monitor start --instruction "Watch how the user completes checkout"
   ```

2. **Hand control to the user.** Tell them they can drive the page normally now. Do NOT issue `act` / `click` / `type` calls during recording — the monitor records *real* events, and injecting synthetic events pollutes the trace.

3. **Watch progress.**
   ```bash
   interceptor monitor status                       # Active sessions + counts
   interceptor monitor tail <sid>                   # Live pretty stream
   interceptor monitor tail <sid> --raw             # Raw JSONL
   ```

4. **Stop when the flow is complete.**
   ```bash
   interceptor monitor stop
   ```
   Or pause/resume if the user needs to interrupt:
   ```bash
   interceptor monitor pause <sid>
   interceptor monitor resume <sid>
   ```

## Export

After stop, choose the right export shape for your goal:

```bash
interceptor monitor export <sid>                   # Aligned-text default, human-readable
interceptor monitor export <sid> --plan            # Replay-plan (highest-value artifact)
interceptor monitor export <sid> --with-bodies     # Include request/response bodies
interceptor monitor export <sid> --json            # Raw JSONL (for piping into a script — not for your own context)
```

**The `--plan` export is the most useful artifact.** It collapses raw events into the minimum steps needed to reproduce the flow — selectors, values, waits — without the noise of mousemove tracks and intermediate keystrokes.

## Replay

For now, replay is human-readable rather than fully automated. Read the `--plan` output as a checklist:
1. Identify each step's selector and action.
2. Map to `interceptor` commands (`open`, `act`, `type`, `keys`, `navigate`, `wait`, `wait-stable`).
3. Re-execute as a sequence. Use `interceptor batch '[{"type":"click",...}, ...]'` to send multi-action sequences in a single round-trip.

Plan replay across multiple agents:
- Save the plan to a `.md` file and hand it to another agent.
- For regression testing, compare current behavior against the captured plan's selectors and values.

## When NOT to record

- **Single-action tasks.** Just run the action directly.
- **Plain page reads.** `read` and `inspect` are cheaper.
- **Network-only investigations.** Use `net log` and `net headers`; record is for *interaction*, not just observation.

## Pitfalls

- **Recording during automation.** Synthetic events injected by `act` *do* land in the monitor stream, but they're noise — you'll capture your own actions, not the user's. Start recording first, then hand off.
- **Forgetting to stop.** Sessions auto-stop after 24 hours; before that, they accumulate events. If you see runaway counts in `monitor status`, stop the orphaned session.
- **Re-using a session id.** Each `monitor start` gets a fresh `sid`. Don't try to "resume" by reusing a stopped session id — use `monitor resume` only if the session is `paused`, not `stopped`.

## Output format

When the user asked you to "watch them do X":
- Confirm recording started (the `sid`)
- Stay quiet during the flow
- After they say "done", stop and export `--plan`
- Return the plan inline or as a path, depending on length

More detail on session lifecycle, cross-tab/focus-follow behavior, and replay-plan generation: [`../references/monitor-and-replay.md`](../references/monitor-and-replay.md).
