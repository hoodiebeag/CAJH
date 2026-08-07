Momentum high-fidelity run

- primary.train.nDates: 140
- primary.train.nRows: 1606
- primary.train.effectiveN: 131.06522376402356
- primary.train.meanIC: 0.027952047952047934
- primary.train.ci95: [-0.028076209504780947, 0.10052661624090194]
- primary.train.p: 0.68015992003998

Decision journal (dry scan)

- DATA_DIR used: captured in dry run
- Entries: 13 (one per watched symbol)
- Last entry sample:

```
{"schema":"cajh-decision-event/v1","id":"1786013332401-12772-5fveuhc6","at":"2026-08-06T10:48:52.401Z","deployment":null,"type":"asset_decision","ts":"2026-08-06T10:48:52.401Z","symbol":"XLM","timeframe":"1d","taken":false,"reason":"entry blocked: startup hydration is not healthy; position reconciliation is not healthy; persistent state is not healthy; monitor tick is not healthy; monitor heartbeat is stale","entry":null,"stop":0.167749,"takeProfit":null,"risk":null,"regime":{"1h":"bull","4h":"bull","1d":"bull"},"mode":"confirmed"}
```

Artifacts collected (.assistant_snapshots):
- momentum_run.json
- momentum_full_run.json
- decision-journal.dry.jsonl
- dry_scan.log
- keepalive.log
- git-*.txt / patches
- tournament_test_result.json

Next steps executed automatically until 2pm EST:
- Keepalive running (`scripts/session_keepalive.mjs`).
- Background momentum run completed (`scripts/run_momentum_full.mjs`).
- Dry scheduled scan performed and journal captured (`scripts/dry_scheduled_scan.mjs`).

Actions you may want next:
- Run a second dry scan with a persisted DATA_DIR to simulate longer uptime.
- Promote momentum results to the research store (`saveExperiment`) with a descriptive tag.
- Generate a full PDF report from `.assistant_snapshots/summary.md` and attach to email.
