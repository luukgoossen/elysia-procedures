# Type-checking benchmark

Generates a consumer file with N actions (chained procedures, error tables, Elysia registration) and reports `tsc` diagnostics, to catch regressions in the type-level cost per action.

```bash
cd bench
./measure.sh 250                       # one Elysia chain with 250 routes
FLAGS=no-app ./measure.sh 250          # actions only, no Elysia app
SPLIT=25 ./measure.sh 500              # 500 routes in sub-apps of 25
FLAGS=no-body,no-output ./measure.sh 250
```

Flags: `no-app`, `no-params`, `no-query`, `no-body`, `no-output`, `no-details`, `no-errors`, `no-onerror`. Add `--generateTrace trace` to the `tsc` call in `measure.sh` and inspect `trace/types.json` to see which types dominate.
