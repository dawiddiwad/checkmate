import { ConfigurationManager } from "../configuration-manager";
import { Step } from "../types";

const PAGE_SNAPSHOT_COMPRESSION_INSTRUCTIONS = `
    #PAGE SNAPSHOT COMPRESSION:
    The page snapshot uses a compressed accessibility tree format where:
    - Element types are abbreviated (g=generic, b=button, l=link, etc.)
    - Text is prefixed with # (e.g., #Submit)
    - Indentation shows hierarchy

    ### Element Type Mappings
    generic: g
    button: b
    link: l
    img: i
    navigation: nav
    list: ul
    listitem: li
    combobox: cb
    searchbox: sb
    tooltip: tltp
    heading: h
    paragraph: p
    table: tbl
    row: tr
    cell: cl
    rowheader: rh
    gridcell: gcl
    columnheader: ch
    rowgroup: rgrp
    article: art
    separator: hr
    tree: tree
    treeitem: ti
    tab: tab
    tablist: tlst
    tabpanel: tpnl
    group: grp
    status: stat
    main: main
    cursor: cur
    disabled: dis
    selected: sel
    level: lv
`

export const RUN_STEP_PROMPT = (step: Step) => `
    Here is the test step I want you to execute.

    ${new ConfigurationManager().enableSnapshotCompression() ? PAGE_SNAPSHOT_COMPRESSION_INSTRUCTIONS : ''}
    
    #RULES:
    Do not close or re-open the browser if any browser tool was used before, keep it open and use it for the entire test case.
    Saving and navigating actions might take some time to complete without clear indication of completion, be patient and wait for the page to load before proceeding.
    Some components might take some time to complete loading without clear indication of completion, be patient and wait for the component to load before proceeding.
    Never ask for any user input, use only tools to proceed with the step. If you cannot proceed, fail the step providing reason as actual result.
    After each step is finished, call the appropriate function to pass or fail the step.
    If the step fails, call the 'fail_test_step' function with the actual result.
    If the step is successful, call the 'pass_test_step' function with the actual result.

    #STEP:
    ${JSON.stringify(step, null, 2)}
`

export const RUN_STEP_PROMPT_LIVE_API = (step: Step) => `
    Here is the test step I want you to execute.

    #RULES#
    Avoid using 'browser_run_code' tool.
    Do not execute any code, do not give any code to the user, do not give any code snippets. USE ONLY TOOLS TO PROCEED WITH THE STEP.
    Never ask for any user input, use only tools to proceed with the step. If you cannot proceed, fail the step providing reason as actual result.
    Do not close or re-open the browser if any browser tool was used before, keep it open and use it for the entire test case.
    Saving and navigating actions might take some time to complete without clear indication of completion, be patient and wait for the page to load before proceeding.
    Some components might take some time to complete loading without clear indication of completion, be patient and wait for the component to load before proceeding.
    After each step is finished, call the appropriate function to pass or fail the step.
    If the step fails, call the 'fail_test_step' function with the actual result.
    If the step is successful, call the 'pass_test_step' function with the actual result.

    #STEP#
    ${JSON.stringify(step, null, 2)}
`