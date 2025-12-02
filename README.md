# checkma♗e

Supercharge your test automation with AI. Write steps in plain English. No locators or tedious maintenance required. Checkmate combines LLMs with Playwright's ecosystem for smarter, more resilient execution.

Enjoy Claude, Gemini, xAI, or any OpenAI API compatible provider - even your private local models via LM Studio and Ollama!

### How it works?
Write tests in natural language:
```javascript
await ai.run({
    action: `Type 'playwright test automation' in the search bar and press Enter`,
    expect: `Search results contain the playwright.dev link`
})
```
...instead of chaining locators, methods and assertions:
```javascript
await page.locator('#search-input').fill('playwright test automation')
await page.press('#search-input', 'Enter')
await expect(page.getByRole('link', { name: '#search-result' })
    .filter({ hasText: 'playwright.dev' }).first())
    .toBeVisible()
```

### Features
*   **Write tests in plain English**: No locators needed.
*   **Web UI**: Works on any web page.
*   **Salesforce UI**: Works with any org with automatic authorization.
*   **Resilient**: Tests adapt automatically to UI changes.
*   **Cost saving**: Optimizes token use, chat history, and screenshots.
*   **Reporting**: Console logs, HTML and JUnit output.

## Quick Start
### Prerequisites

- Node.js [18+ or LTS](https://nodejs.org/en/download) 
- OpenAI [API key](https://platform.openai.com/api-keys) (or compatible provider: Claude, Gemini, xAI etc.)
- (optional) [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) for Salesforce testing

### Installation

```bash
# Clone the repository
git clone https://github.com/dawiddiwad/checkmate.git
cd checkmate

# Install dependencies
npm install

# Copy environment template and configure
cp .env.example .env
# Edit .env with your API key
```

### Configuration

Edit `.env` file based on `.env.example` that has a comprehensive configuration reference:

```bash
# Example configuration for Google Gemini (recommended)

# Get a free Gemini API key from https://aistudio.google.com/app/api-keys
OPENAI_API_KEY=your_api_key_here

# Google Gemini Base URL for OpenAI-compatible API
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/

# Model configuration
OPENAI_MODEL=gemini-2.5-flash
OPENAI_TEMPERATURE=0

# Token usage guardrails per test
OPENAI_API_TOKEN_BUDGET_USD=0.5
OPENAI_API_TOKEN_BUDGET_COUNT=1000000
```

### Running Tests

```bash
# Run web application tests
npm run test:web

# Run Salesforce tests (requires SF CLI authentication)
npm run test:salesforce

# Run experimental live API tests (faster responses)
npm run test:live

# View HTML report
npx playwright show-report test-reports/html

# View Playwright traces
npx playwright show-trace test-results/traces/trace.zip
```

## Writing Tests

Tests are written using natural language specifications with `action` and `expect` fields:

```typescript
import { test } from "../../fixtures/checkmate"

test('search for playwright documentation', async ({ ai }) => {
    await test.step('Navigate to Google', async () => {
        await ai.run({
            action: `Open the browser and navigate to google.com`,
            expect: `google.com is loaded and the search bar is visible`
        })
    })
    
    await test.step('Search for Playwright', async () => {
        await ai.run({
            action: `Type 'playwright test automation' in the search bar and press Enter`,
            expect: `Search results contain the playwright.dev link`
        })
    })
})
```

### Best Practices

1. **Be Specific** - Clear expectations help the AI validate success
2. **One Action Per Step** - Break complex flows into discrete steps
3. **Include Context** - Mention relevant UI elements and expected behavior
4. **Add Timing Hints** - For slow operations, mention expected wait times
5. **Handle Popups** - Explicitly mention consent dialogs or modals

### Example: Complex Interaction

```typescript
await test.step('Fill form and submit', async () => {
    await ai.run({
        action: `
            Wait for the newsletter popup (takes ~30 seconds), 
            then close it by clicking the X button.
            Scroll to the comment section and click to activate it.
            Type 'Great article!' into the comment textarea.
            Click the Submit button.
        `,
        expect: `
            The comment is submitted, 
            and either a success message appears 
            or a login form is displayed if not authenticated.
        `
    })
})
```
## Configuration

### OpenAI API Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | **Required** - Your OpenAI API key (or compatible provider) |
| `OPENAI_BASE_URL` | - | Optional - Override for compatible providers (Claude, Gemini, local LLMs) |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model: gpt-4o, gpt-4o-mini, claude-3-5-sonnet-latest, gemini-2.5-flash, etc. |
| `OPENAI_TEMPERATURE` | `0.1` | Creativity (0=deterministic, 1=creative) |
| `OPENAI_TIMEOUT_SECONDS` | `60` | API request timeout in seconds |
| `OPENAI_RETRY_MAX_ATTEMPTS` | `3` | Max retries with backoff (1s, 10s, 60s) for rate limits and server errors |
| `OPENAI_TOOL_CHOICE` | `required` | Tool choice: auto, required, none |
| `OPENAI_ALLOWED_TOOLS` | - | Comma-separated list of allowed tools (if not set, all tools available) |
| `OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT` | `false` | Include compressed screenshots in snapshot responses |
| `OPENAI_ENABLE_SNAPSHOT_COMPRESSION` | `true` | Enable abbreviated element notation for snapshots (~40% token reduction) |
| `OPENAI_API_TOKEN_BUDGET_USD` | - | Optional - USD budget for total OpenAI API spend per test run. Only positive decimal values are enforced.
| `OPENAI_API_TOKEN_BUDGET_COUNT` | - | Optional - Token count limit for total tokens per test run. Only positive integers are enforced.
| `OPENAI_LOOP_MAX_REPETITIONS` | `5` | Number of repetitive tool call patterns to detect before triggering loop recovery with random temperature |

### Playwright MCP Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYWRIGHT_MCP_VERSION` | `latest` | MCP package version (eg: 0.4.5) |
| `PLAYWRIGHT_MCP_BROWSER` | `chromium` | Browser: chromium, firefox, webkit |
| `PLAYWRIGHT_MCP_HEADLESS` | `false` | Run browser in headless mode |
| `PLAYWRIGHT_MCP_OUTPUT_DIR` | `./test-results` | Screenshots and traces location |
| `PLAYWRIGHT_MCP_SAVE_VIDEO_SIZE` | - | Record video: WxH format (eg: 1280x720) |
| `PLAYWRIGHT_MCP_ISOLATED` | `true` | Use isolated browser contexts |
| `PLAYWRIGHT_MCP_CAPS` | - | Custom browser capabilities (JSON) |

## Cost Management

Checkmate includes built-in token usage monitoring:

```
| token usage
| response input: 2543 @ $0.00$
| response output: 456 @ $0.00$
| history (estimated): 45234
| step input: 5123 @ $0.00$
| step output: 892 @ $0.00$
| test input: 25678 @ $0.01$
| test output: 4521 @ $0.01$
```

### Cost Optimization Features

1. **History Filtering** - Continuously filters page snapshots and old screenshots from chat history (reduces token usage by ~50%)
2. **Snapshot Compression** - YAML tree elements abbreviation (further ~40% token usage reduction)
3. **Vision API Screenshots** - Images sent using OpenAI's vision API with `detail: low` (85 tokens per screenshot)
4. **Chat Recycling** - New session per step to prevent context bloat
5. **Token Counting** - Real-time usage tracking per step and test with budgets

### Budgeting & Cost Limits

You can set one or both token budget environment variables to enforce limits during a single test run.

- `OPENAI_API_TOKEN_BUDGET_USD` — Sets a USD budget (e.g. 10.50). The framework checks the current estimated cost (input+output tokens) and throws an error if the budget is exceeded.
- `OPENAI_API_TOKEN_BUDGET_COUNT` — Sets a token limit (e.g. 100000). The framework tracks input and output tokens across the test and throws an error when the total exceeds this limit.

Notes:
- Only positive numbers are enforced; `0` or non-positive values are effectively treated as disabled.
- If the env var is unset or invalid (non-number), it is ignored.

### Estimated Costs (Gemini 2.5 Flash / GPT 5 mini)

- Simple web test (5 steps): ~$0.01 - $0.05
- Complex Salesforce flow (20 steps): ~$0.10 - $0.40
- Full test suite (50 tests): ~$5.00 - $20.00

*Costs vary based on model, screenshot size and count, and page complexity*

## Salesforce Testing

Checkmate includes native Salesforce support using the SF CLI:

### Prerequisites

```bash
# Install Salesforce CLI
npm install -g @salesforce/cli

# Authenticate to your org and set is as default
sf org login web --alias my-checkmate-org --set-default
```

### Example Salesforce Test

```typescript
test('create and configure itinerary', async ({ ai }) => {
    await test.step('Login to Salesforce', async () => {
        await ai.run({
            action: `Login to Salesforce org and open Test QA Application`,
            expect: `Test QA homepage is displayed`
        })
    })
    
    await test.step('Create new itinerary', async () => {
        await ai.run({
            action: `
                Click 'New', select 'Quote' record type, 
                fill 'Itinerary Name' = 'AI Test', 
                'Account' = 'Test Account', 
                'Group Size' = '5', 
                then Save
            `,
            expect: `New itinerary is saved and details page is displayed`
        })
    })
})
```

The `login_to_salesforce_org` tool handles the complete Salesforce authentication flow:
1. Retrieves a front-door URL from the authenticated SF CLI session
2. Automatically navigates the browser to login

No manual URL handling needed - just call "Login to Salesforce" in your test action.

## Test Reports

Multiple report formats are generated after each run:

- **HTML Report**: `test-reports/html/index.html` (interactive - no screenshots/video yet though)
- **JUnit XML**: `test-reports/junit/results.xml` (CI/CD integration)
- **Console Output**: Real-time step results and token usage

```bash
# Open HTML report in browser
npx playwright show-report test-reports/html
```

## Common Issues

**Test hangs at step execution**
- Check if the page loaded correctly (look for navigation errors)
- Verify API key is valid and has quota
- Increase timeout in `playwright.config.ts`

**AI makes wrong decisions**
- Add more context in the `action` description
- Mention specific element identifiers (text, labels)
- Use step-by-step approach instead of complex multi-action steps

**High token costs**
- Use more specific selectors in descriptions
- Consider caching (see Roadmap)

### Architecture:
The framework combines:
- **OpenAI-compatible API** for understanding and decision-making (works with OpenAI, Claude, Gemini, and local LLMs)
- **Playwright Test** for managing test runs, fixtures and reporting
- **Playwright MCP** (Model Context Protocol) for browser automation
- **Salesforce CLI** for Salesforce-specific operations
- **Modular Components**: Configuration management, response processing, token tracking, history filtering, snapshot compression, screenshot compression
- **Experimental Live API**: Real-time AI interactions with streaming responses (Gemini-specific)

Playwright test runner calls into the OpenAI step engine via fixture, which orchestrates API calls and tool invocations, then feeds results back into the test runner. Supporting modules hang off that core to manage configuration, history, screenshots, and costs:

```
═════════════════════════ FLOW ════════════════════════════════

Playwright Test Step 
    │
Checkmate fixture
    │
OpenAITestManager
    │
OpenAITestStep
    │
    ├─► OpenAIClient.initialize()
    │       │
    │       ├─► ConfigurationManager.getOpenAIConfig()
    │       └─► ToolRegistry.getTools()
    │
    ├─► OpenAIClient.sendMessageWithRetry(prompt)
    │       │
    │       └─► OpenAI-compatible API
    │
    └─► ResponseProcessor.handleResponse(response)
            │
            ├─► TokenTracker.log()
            │
            ├─► tool_calls:
            │       │
            │       ├─► browser_* → ToolRegistry.executeBrowserTool()
            │       │       └─► PlaywrightTool → PlaywrightMCP → Browser
            │       │
            │       ├─► test_step_* → ToolRegistry.executeStepTool()
            │       │       └─► StepTool → StepStatusCallback
            │       │
            │       └─► salesforce_* → ToolRegistry.executeSalesforceTool()
            │               └─► SalesforceTool → Salesforce CLI
            │
            └─► snapshot:
                    └─► SnapshotProcessor.getCompressed()
                    └─► ScreenshotProcessor.getCompressedScreenshot()
                    └─► HistoryManager.removeSnapshotEntries()
                    └─► OpenAIClient.replaceHistory()

═════════════════════════ ARCHITECTURE ════════════════════════════════

Playwright Test Layer
    │
    ├─► checkmate.ts (fixture)
    │       │
    │       └─► OpenAITestManager
    │               │
    │               ├─► playwrightMCP: OpenAIServerMCP
    │               ├─► openaiClient: OpenAIClient
    │               ├─► responseProcessor: ResponseProcessor
    │               │
    │               └─► OpenAITestStep (Internal)
    │                       │
    │                       ├─► Orchestrates step execution
    │                       ├─► Manages step status callbacks
    │                       └─► Handles assertions
    │
    └─► checkmate-live.ts (experimental fixture - Gemini Live API)
            │
            └─► GeminiLiveSessionManager
                    │
                    ├─► playwrightMCP: GeminiServerMCP
                    ├─► ai: GoogleGenAI
                    ├─► session: Live Session
                    ├─► playwrightTool: GeminiPlaywrightTool
                    ├─► stepTool: GeminiStepTool
                    └─► salesforceTool: GeminiSalesforceTool

Core Components Layer
    │
    ├─► OpenAIClient
    │       │
    │       ├─► Dependencies:
    │       │       ├─► configurationManager: ConfigurationManager
    │       │       └─► toolRegistry: ToolRegistry
    │       │
    │       └─► Responsibilities:
    │               ├─► Initialize OpenAI client
    │               ├─► Manage chat completions
    │               ├─► Send messages with retry
    │               ├─► Manage conversation history
    │               └─► Token counting
    │
    ├─► ResponseProcessor
    │       │
    │       ├─► Dependencies:
    │       │       ├─► playwrightMCP: OpenAIServerMCP
    │       │       └─► openaiClient: OpenAIClient
    │       │
    │       └─► Responsibilities:
    │               ├─► Process OpenAI API responses
    │               ├─► Handle tool calls
    │               ├─► Dispatch tool responses
    │               ├─► Manage recursive tool calls
    │               └─► Handle screenshots
    │
    └─► ToolRegistry
            │
            ├─► Dependencies:
            │       ├─► playwrightMCP: OpenAIServerMCP
            │       ├─► playwrightTool: PlaywrightTool
            │       ├─► stepTool: StepTool
            │       └─► salesforceTool: SalesforceTool
            │
            └─► Responsibilities:
                    ├─► Aggregate function declarations from all tools
                    ├─► Route tool execution to appropriate handler
                    ├─► executeBrowserTool()
                    ├─► executeStepTool()
                    └─► executeSalesforceTool()

Tools Layer
    │
    ├─► PlaywrightTool (implements OpenAITool)
    │       │
    │       ├─► Dependencies:
    │       │       └─► playwrightMCP: OpenAIServerMCP
    │       │
    │       └─► Functions:
    │               └─► browser_* (from MCP: click, navigate, snapshot, etc.)
    │
    ├─► StepTool (implements OpenAITool)
    │       │
    │       ├─► Dependencies:
    │       │       └─► (none)
    │       │
    │       └─► Functions:
    │               ├─► pass_test_step
    │               └─► fail_test_step
    │
    └─► SalesforceTool (implements OpenAITool)
            │
            ├─► Dependencies:
            │       ├─► PlaywrightTool (for browser navigation)
            │       └─► SalesforceCliAuthenticator
            │
            └─► Functions:
                    └─► login_to_salesforce_org (gets frontdoor URL + navigates browser)

MCP Server Layer
    │
    ├─► OpenAIServerMCP
    │       │
    │       ├─► Wraps Model Context Protocol SDK
    │       ├─► Manages MCP client connections
    │       ├─► Converts MCP tools to OpenAI function declarations
    │       ├─► Handles tool execution via MCP protocol
    │       └─► Cleans schemas for OpenAI compatibility
    │
    └─► PlaywrightMCPServer
            │
            ├─► Creates OpenAIServerMCP instance for Playwright
            ├─► Configures via environment variables
            └─► Spawns @playwright/mcp server process

Supporting Components
    │
    ├─► ConfigurationManager
    │       │
    │       ├─► API key/config management
    │       ├─► Model selection
    │       ├─► Retry settings
    │       ├─► Temperature configuration
    │       ├─► Timeout configuration
    │       └─► Function allowlist
    │
    ├─► HistoryManager
    │       │
    │       ├─► Remove snapshots from history
    │       └─► Filter history entries
    │
    ├─► SnapshotProcessor
    │       │
    │       ├─► Compress accessibility tree snapshots
    │       ├─► Abbreviate elements (ex. link -> l, button -> b)
    │       └─► Compact notation for refs and attributes
    │
    ├─► ScreenshotProcessor
    │       │
    │       ├─► Compress screenshots
    │       ├─► Resize images
    │       └─► Base64 encoding
    │
    ├─► TokenTracker
    │       │
    │       ├─► Track token usage
    │       ├─► Calculate costs
    │       └─► Log pricing information
    │
    └─► SalesforceCliAuthenticator
            │
            ├─► Authenticate with Salesforce CLI
            ├─► Generate front door URLs
            └─► Uses SalesforceCliHandler

External Services
    │
    ├─► OpenAI-compatible API
    │       │
    │       ├─► Chat Completions API
    │       ├─► Tool/Function calling
    │       └─► Supports: OpenAI, Claude, Gemini, local LLMs
    │
    ├─► Playwright MCP Server
    │       │
    │       ├─► Browser automation
    │       ├─► DOM manipulation
    │       ├─► Screenshots
    │       └─► Navigation
    │
    └─► Salesforce CLI
            │
            ├─► Org management
            ├─► Authentication
            └─► URL generation
```

## Contributing
### Key Areas for Contribution

  - Additional tool integrations (ex. API testing)
  - Improved error handling and retry logic
  - Api cost optimization
  - Improved prompt and context engineering
  - Performance

### License

MIT License - see LICENSE file for details

### Learn More

- [Playwright MCP](https://github.com/microsoft/playwright/tree/main/utils/mcp-server)
- [Playwright Documentation](https://playwright.dev/)
- [OpenAI API](https://platform.openai.com/docs/api-reference)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Model Context Protocol](https://modelcontextprotocol.io/introduction)

---

**Experimental Project Notice**

Checkmate is an experimental framework exploring AI-driven test automation. While functional, it's not yet recommended for production CI/CD pipelines. Expect:
- Non-deterministic behavior
- Higher runtime costs than traditional automation
- Occasional timeouts
- Rate limiting errors depending on your API provider

Use for exploratory testing, rapid prototyping, and demonstrating AI capabilities in testing.

---

**Future Vision**

The roadmap includes plans for caching, RAG-based element retrieval, visual testing, and eventually becoming a production-ready testing platform.

This project is primarily an exploration of how AI can democratize test automation by making it less technical and more maintainable! 🚀

---
Built with ❤️ by Dawid Dobrowolski