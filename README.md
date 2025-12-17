# **checkmate**

Supercharge your test automation with AI. Write steps in plain English. No locators or tedious maintenance required. Checkmate combines LLMs with Playwright's ecosystem for smarter, more resilient execution.

Enjoy Claude, Gemini, xAI, or any OpenAI API compatible provider - even your private local models via LM Studio or llama.cpp!

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
*   **Reporting**: Playwright reports with attachments, tracing and debug logs.

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
```

### Running Tests

```bash
# Run web application tests
npm run test:web

# Run Salesforce tests (requires SF CLI authentication)
npm run test:salesforce

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
| `OPENAI_MODEL` | `gpt-5-mini` | Model: gpt-5, gemini-2.5-flash, claude-4-5-sonnet etc. |
| `OPENAI_TEMPERATURE` | `1.0` | Creativity (below 0.5 = deterministic, above 0.5 = creative) |
| `OPENAI_REASONING_EFFORT` | - | Optional - Reasoning effort for models: low, medium, high |
| `OPENAI_TIMEOUT_SECONDS` | `60` | API request timeout in seconds |
| `OPENAI_RETRY_MAX_ATTEMPTS` | `3` | Max retries with backoff (1s, 10s, 60s) for rate limits and server errors |
| `OPENAI_TOOL_CHOICE` | `required` | Tool choice: auto, required, none |
| `OPENAI_ALLOWED_TOOLS` | - | Comma-separated list of allowed tools (if not set, all tools available) |
| `OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT` | `false` | Include compressed screenshots in snapshot responses |
| `OPENAI_API_TOKEN_BUDGET_USD` | - | Optional - USD budget for total OpenAI API spend per test run. Only positive decimal values are enforced.
| `OPENAI_API_TOKEN_BUDGET_COUNT` | - | Optional - Token count limit for total tokens per test run. Only positive integers are enforced.
| `OPENAI_LOOP_MAX_REPETITIONS` | `5` | Number of repetitive tool call patterns to detect before triggering loop recovery with random temperature |
| `CHECKMATE_LOG_LEVEL` | `off` | Logging verbosity: debug, info, warn, error, off |

### Playwright Configuration

Browser settings (viewport, headless mode, video recording, timeouts, etc.) are configured in [playwright.config.ts](playwright.config.ts) using Playwright's [standard](https://playwright.dev/docs/test-configuration) configuration mechanism.

## Cost Management

Checkmate includes built-in token usage monitoring:

```json
{
  "response input": "2543 @ $0.00$",
  "response output": "456 @ $0.00$",
  "history (estimated)": 45234,
  "step input": "5123 @ $0.00$",
  "step output": "892 @ $0.00$",
  "test input": "25678 @ $0.01$",
  "test output": "4521 @ $0.01$"
}
```

### Cost Optimization Features

1. **History Filtering** - Continuously filters old page snapshots (reduces token usage by ~50%)
2. **Snapshot Minification** - Removes unnecessary whitespace and quotes from accessibility tree snapshots
3. **Screenshots** - Normalized and compressed locally and sent using OpenAI's API with `detail: low`
4. **Chat Recycling** - New session per step to prevent context bloat
5. **Token Counting** - Real-time usage tracking per step and test with budgets
6. **Loop Detection** - Detects repetitive tool call patterns and adjusts temperature to break out of loops, preventing runaway token consumption

### Budgeting & Cost Limits

You can set one or both token budget environment variables to enforce limits during a single test run.

- `OPENAI_API_TOKEN_BUDGET_USD` — Sets a USD budget (e.g. 0.50) per test execution. The framework checks the current estimated cost (input+output tokens) and throws an error if the budget is exceeded.
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

**AI makes incorrect decisions**
- Provide more detailed descriptions in `action` and more focused assertions in `expect`
- Reference specific element identifiers and roles (for example: text, label, button, list)
- Break complex workflows into single-action steps; use a step-by-step approach

**Tests loop during step execution**
- Increase `OPENAI_TEMPERATURE` to encourage exploration
- Use a reasoning/thinking model (if available) to improve planning and avoid repetitive loops

**High token costs**
- Set a lower reasoning effort: `OPENAI_REASONING_EFFORT`
- Consider disabling `OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT`
- Use a cheaper model, lower-end models often perform well (e.g., `gemini-2.5-flash-lite` or `gpt-5-nano`)

## Architecture

Checkmate combines multiple components to enable AI-driven test automation:

```
Playwright Test (Runner & Reporting)
│
└── ai.run(step) ← Checkmate Fixture
    │
    └── Step Manager
        │
        ├── OpenAI Client
        │   ├── Chat completions with tool calling
        │   ├── Token tracking & cost management
        │   └── Loop detection & recovery
        │
        ├── Tool Registry
        │   ├── Browser (click, type, navigate)
        │   ├── Step (pass/fail)
        │   └── Salesforce (login, auth)
        │
        ├── Response Processor
        │   ├── Snapshot minification
        │   └── History management
        │
┌───────┴─────┬──────────────┬────────────────┐
│             │              │                │
Playwright    OpenAI API     Salesforce CLI   Configuration
│             │              │                │
├─ Browsers   ├─ GPT         ├─ SF Auth       ├─ .env
├─ Snapshots  ├─ Gemini      └─ OTP URL       └─ playwright.config.ts
├─ Actions    ├─ Local
└─ Reports    └─ etc...
```

### Key Components

**Test Layer**
- Playwright Test framework manages test execution, reporting, and fixtures
- Tests written in natural language via `ai.run()` fixture

**Core Engine**
- **OpenAI Test Manager**: Orchestrates AI-driven test steps
- **OpenAI Client**: Manages LLM interactions with tool calling
- **Response Processor**: Handles tool responses, snapshot minification, and history filtering
- **Tool Registry**: Routes tool calls to appropriate handlers

**Tools**
- **Browser Tools**: Playwright Test for web automation (click, type, navigate, etc.)
- **Step Tools**: Test control (pass/fail step assertions)
- **Salesforce Tools**: SF CLI integration for Salesforce testing

**Cost Optimization**
- Token tracking with budget enforcement
- History filtering (removes old snapshots)
- Snapshot minification and screenshot compression
- Loop detection and mitigation

**Configuration**
- Test, Reporting and Browser settings: [playwright.config.ts](playwright.config.ts)
- API & AI settings: `.env` file

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

- [Playwright Documentation](https://playwright.dev/)
- [OpenAI API](https://platform.openai.com/docs/api-reference)

---

**Experimental Project Notice**

Checkmate is an experimental framework exploring AI-driven test automation. While functional, it's not yet recommended for production CI/CD pipelines. Expect:
- Non-deterministic behavior
- Higher runtime costs than traditional automation
- Occasional timeouts
- Rate limiting depending on your API provider and service tier

Use for exploratory testing, rapid prototyping, and demonstrating AI capabilities in testing.

---

**Future Vision**

The roadmap includes plans for caching, RAG-based element retrieval, visual testing, and eventually becoming a production-ready testing platform.

This project is primarily an exploration of how AI can democratize test automation by making it less technical and more maintainable! 🚀

---
Built with ❤️ by Dawid Dobrowolski