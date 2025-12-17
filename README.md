# *****checkmate*****

AI-powered e2e testing that actually works. Write tests in plain English, no locators, no maintenance headaches.

## Why?

Stop fighting brittle selectors. Stop rewriting tests every sprint. Write what you want to test, and let AI handle the rest.

traditional playwright:
```javascript
await page.locator('#search-input').fill('playwright test automation')
await page.press('#search-input', 'Enter')
await expect(page.getByRole('link', { name: 'search-result', { exact: true } })
    .filter({ hasText: 'playwright.dev' })
    .first(), 'playwright.dev link should be visible')
    .toBeVisible( { timeout: 30 * 1000 } )
```

*****checkmate***:**
```javascript
await ai.run({
    action: `Type 'playwright test automation' in the search bar and press Enter`,
    expect: `Search results contain the playwright.dev link`
})
```

## What You Get

✅ **Zero Locators** - Write tests in plain English  
✅ **Self-Healing** - Tests adapt to UI changes automatically  
✅ **Any Provider** - Claude, Gemini, GPT, xAI, or local models  
✅ **Web & Salesforce** - Native support for both platforms  
✅ **Cost Optimized** - Built-in token management and budgeting  
✅ **Full Playwright** - Reports, traces, debugging - all included

## Get Started in 5 Minutes

### 1. Install

```bash
git clone https://github.com/dawiddiwad/checkmate.git
cd checkmate
npm run install
```

### 2. Configure `.env`

*using [OpenAI API](https://platform.openai.com/settings/organization/api-keys) key and default settings:*
```bash
OPENAI_API_KEY=#your_api_key_here
```

*...or for other providers, set the base URL and model too:*
```bash
OPENAI_API_KEY=#your_api_key_here
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=openai/gpt-oss-20b
```

*For provider I highly recommended [Groq.com](https://groq.com)*.  
*They host blazing fast, secure, open source models at [low cost](https://groq.com/pricing)*.  
*You can start with a free key here: [https://console.groq.com/keys](https://console.groq.com/keys)*


### 3. Run Tests

```bash
npm run test:web:example         # Run a short test
npm run show:report              # View results
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

That's it. No page objects, no selectors, no flake.

### Tips for Success

- **Be specific** about what you want and what success looks like
- **One action per step** - break complex flows into simple steps
- **Mention timing** - if something takes a while, say so
- **Handle popups** - call out modals and dialogs explicitly

See [GUIDE.md](GUIDE.md) for detailed examples and best practices. Playwright Configuration

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
Runtime cost estimates with [gpt-oss-20b hosted on groq.com](https://console.groq.com/docs/model/openai/gpt-oss-20b) (highly recommended):
- **Simple test (~5 steps): ~$0.001 - $0.01**
- Complex test (~20 steps): ~$0.01 - $0.05
- Full E2E suite (~50 complex tests): ~$1.00 - $2.00

See [GUIDE.md](GUIDE.md#cost-management) for detailed cost control options

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

## FAQ

**Is this production-ready?**  
Kind of... yes? Great if you feel that [pesticide paradox](https://medium.com/@suwekasansiluni/the-pesticide-paradox-what-farming-teaches-us-about-software-testing-ab5d625d4de1) is an issue in automated E2E testing ;) You should expect and accept somewhat non-deterministic behavior and occasional flakiness - and take advantage of it in your tests. For majority of cases, the maintenance savings, rapid development and non-linear execution outweigh occasional hickups. If you need 100% deterministic tests 100% of time, traditional playwright is still the way to go.

**What models work best?**  
Checkmate is designed to work with any OpenAI-compatible model, but here are best picks based on extensive testing:
* Highly recommend [`gpt-oss` `20b` or `120b` hosted on groq.com](https://console.groq.com/docs/model/openai/gpt-oss-20b) as best cost / speed / quality option. Groq's infrastructure is optimized for low-latency and high-throughput LLM workloads making it ideal for E2E test automation. Models are blazing fast and cost-effective.
* Google's `gemini-2.5-flash` offers the best balance of cost and performance if major cloud providers are preferred.
* OpenAI's `gpt-5-mini`, `gpt-5-nano` and xAI's `grok-4-1-fast-reasoning` also work very well keeping costs reasonably low.

**Can I use local models?**  
Yes! Works with any OpenAI-compatible API, including local models via LM Studio, Ollama or llama.cpp.  
I recommend [qwen3-4b-instruct](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) 4 bit quant variant. It is fast (100 tokens/sec on RTX 3060Ti) and (40 tokens/sec on Apple M3) performing surprisingly well for e2e testing tasks.

**Does it work with CI/CD?**  
Absolutely! Use it as part of your existing [Playwright Test suites in any CI/CD pipeline](https://playwright.dev/docs/best-practices#run-tests-on-ci). You can blend AI-driven tests, steps and actions with traditional ones as needed.

## Documentation

- [GUIDE.md](GUIDE.md) - Complete technical documentation
- [ROADMAP.md](ROADMAP.md) - Future plans and development
- [Playwright Docs](https://playwright.dev/)

## Contributing

We'd love your help! Key areas:
- Additional tool integrations (API testing, Salesforce, etc.)
- Further cost optimization techniques
- Context and prompt engineering improvements
- Error handling and recovery

## License

MIT License - see [LICENSE](LICENSE) file for details

## Why I build this?

Test automation shouldn't require a PhD in XPath. This project explores how AI can make testing accessible - less technical debt, more actual testing.

Built with ❤️ by [Dawid Dobrowolski](https://github.com/dawiddiwad)