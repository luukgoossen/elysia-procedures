#!/bin/bash
# usage: [FLAGS=no-x,no-y] [SPLIT=25] ./measure.sh <N>
bun gen.ts $1 >/dev/null
../node_modules/.bin/tsc -p tsconfig.json --extendedDiagnostics 2>&1 | grep -E "error TS|Instantiations|Types:|Memory|Check time" | tr -s ' ' | tr '\n' ' '; echo
