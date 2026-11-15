#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/workspace.sh"
write_app
setup_target
approved_stock_plan
closed_defect_run
