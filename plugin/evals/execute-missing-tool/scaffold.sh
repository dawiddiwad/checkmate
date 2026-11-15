#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/workspace.sh"
write_app
setup_target
approved_stock_plan
begun_run run-1 T1,T2,T3 b1
