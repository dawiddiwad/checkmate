/**
 * Constants for Playwright MCP tool names.
 * These tools come from the Playwright MCP server dynamically,
 * but we reference some of them directly in the codebase.
 * 
 * @see https://github.com/microsoft/playwright-mcp
 */
export const PlaywrightToolNames = {
    // Core automation
    BROWSER_CLICK: 'browser_click',
    BROWSER_CLOSE: 'browser_close',
    BROWSER_CONSOLE_MESSAGES: 'browser_console_messages',
    BROWSER_DRAG: 'browser_drag',
    BROWSER_EVALUATE: 'browser_evaluate',
    BROWSER_FILE_UPLOAD: 'browser_file_upload',
    BROWSER_FILL_FORM: 'browser_fill_form',
    BROWSER_HANDLE_DIALOG: 'browser_handle_dialog',
    BROWSER_HOVER: 'browser_hover',
    BROWSER_NAVIGATE: 'browser_navigate',
    BROWSER_NAVIGATE_BACK: 'browser_navigate_back',
    BROWSER_NETWORK_REQUESTS: 'browser_network_requests',
    BROWSER_PRESS_KEY: 'browser_press_key',
    BROWSER_RESIZE: 'browser_resize',
    BROWSER_RUN_CODE: 'browser_run_code',
    BROWSER_SELECT_OPTION: 'browser_select_option',
    BROWSER_SNAPSHOT: 'browser_snapshot',
    BROWSER_TAKE_SCREENSHOT: 'browser_take_screenshot',
    BROWSER_TYPE: 'browser_type',
    BROWSER_WAIT_FOR: 'browser_wait_for',

    // Tab management
    BROWSER_TABS: 'browser_tabs',

    // Browser installation
    BROWSER_INSTALL: 'browser_install',

    // Coordinate-based (opt-in via --caps=vision)
    BROWSER_MOUSE_CLICK_XY: 'browser_mouse_click_xy',
    BROWSER_MOUSE_DRAG_XY: 'browser_mouse_drag_xy',
    BROWSER_MOUSE_MOVE_XY: 'browser_mouse_move_xy',

    // PDF generation (opt-in via --caps=pdf)
    BROWSER_PDF_SAVE: 'browser_pdf_save',

    // Test assertions (opt-in via --caps=testing)
    BROWSER_GENERATE_LOCATOR: 'browser_generate_locator',
    BROWSER_VERIFY_ELEMENT_VISIBLE: 'browser_verify_element_visible',
    BROWSER_VERIFY_LIST_VISIBLE: 'browser_verify_list_visible',
    BROWSER_VERIFY_TEXT_VISIBLE: 'browser_verify_text_visible',
    BROWSER_VERIFY_VALUE: 'browser_verify_value',

    // Tracing (opt-in via --caps=tracing)
    BROWSER_START_TRACING: 'browser_start_tracing',
    BROWSER_STOP_TRACING: 'browser_stop_tracing',
} as const

export type PlaywrightToolName = typeof PlaywrightToolNames[keyof typeof PlaywrightToolNames]
