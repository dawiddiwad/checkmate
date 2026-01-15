# Checkmate Roadmap

This roadmap outlines the planned features and improvements for checkmate.

## Version 0.1

**Status**:

- ✅ Core Gemini integration with function calling
- ✅ Playwright MCP server integration
- ✅ Natural language test specifications
- ✅ Basic token usage monitoring
- ✅ Screenshot compression for cost optimization
- ✅ Chat history filtering
- ✅ Salesforce CLI integration
- ✅ Multi-project test organization
- ✅ HTML and JUnit reporting
- ✅ Enhanced architecture with modular components
- ✅ Retry logic and error handling
- ✅ Configuration management system
- ✅ Experimental Gemini Live API integration

## Version 0.2

**Focus**: OpenAI API, Stability, Observability, and Cost Control

- ✅ **OpenAI API Migration**
  - ✅ Move from Gemini API to OpenAI API

- ✅ **Comprehensive Documentation**
  - ✅ README with setup instructions
  - ✅ Roadmap document
  - ✅ Environment configuration examples
  - ✅ Architecture diagrams
  - ✅ Best practices guide

- ✅ **Playwright Test Migration from MCP server**
  - ✅ Direct Playwright API access in tools
  - ✅ Screenshots, videos, browser events
  - ✅ Snapshot screenshots as blobs
  - ✅ Normalized configuration and context

- ✅ **Usage Monitoring & Limits**
  - ✅ Basic token counting per step
  - ✅ Cost calculation per test
  - ✅ Token usage tracking per component
  - ✅ Budget limits
  - ✅ Compress YAML page snapshots

- ✅ **Error Handling & Timeouts**
  - ✅ Automatic retry logic with exponential backoff
  - ✅ API request timeouts
  - ✅ Graceful handling of API failures
  - ✅ Tool-level timeouts
  - ✅ Better error messages with recovery suggestions
  - ✅ Fallback strategies when AI fails
  - ✅ Circuit breaker for repeated failures

- ✅ **Guardrails**
  - ✅ Repetitive loop detection
  - ✅ Detect and prevent identical tool calls
  - ✅ Tool response timeout retry logic
  - ✅ Maximum tokens per step limit
  - ✅ Rate limiting for API calls

- ✅ **Logging & Post-Processing**
  - ✅ Detailed step execution logging
  - ✅ Token usage logging per step
  - ✅ Structured logging
  - ✅ Log levels: INFO, WARN, ERROR, DEBUG
  - ✅ AI reasoning/thought capture

## Version 0.3 (in progress...)

**Focus**: Fuzzy Search, UI, E2E modes, Visual Testing

- ✅ **Fuzzy Search**
  - ✅ Dice Coefficient matching for UI elements
  - ✅ User-provided search keywords for snapshot filtering
  - ✅ Fully local ultra fast algorithmic filtering (no LLM keyword extraction)
  - ✅ Snapshot tree is filtered using keyword matching
  - ✅ Reduces token consumption by up to 90% on complex pages

- [ ] **UI Layer V1**
  - [ ] Automatic test generation from recorded actions (video and streaming)
  - [ ] Drag-and-drop test step builder
  - [ ] Real-time test execution viewer
  - [ ] Run, Pause, Resume, Re-start ability
  - [ ] Commit/Read test cases in native playwright format

- [ ] **E2E modes**
  - [ ] step‑by‑step (hard) assertions mode
  - [ ] step‑by‑step (soft) assertions mode
  - [ ] flow mode using a set of E2E goals as assertions rather than discrete steps:
    - [ ] execution is driven by a plan, which can be:
      - [ ] text (natural language description of the desired workflow)
      - [ ] video (recording of an example execution)
      - [ ] step‑by‑step test case written in natural language (Playwright test spec)
    - [ ] tests are spawned in series (e.g., 10) using controlled temperature jitter to promote slight variance for each run. At the end, the average pass rate is used to calculate an E2E flow health‑check score

- [ ] **Visual Testing**
  - [ ] Proper screenshot scaling for Playwright MCP vision tools

## Version 0.4

**Focus**: Performance, Production Readiness & Scaling

- [ ] **Explicit Caching?**
  - [ ] Cache common page structures
  - [ ] Cache UI element mappings
  - [ ] Intelligent cache invalidation

- [ ] **RAG‑Based Element Retrieval?**
  - [ ] Store page snapshots in Gemini File API
  - [ ] Vector search for relevant UI elements
  - [ ] New `page_focused_snapshot` tool
  - [ ] Handles large/complex pages efficiently
  - [ ] Reduces token consumption by 60%

- ✅ **Standalone Playwright Integration?**
  - ✅ Option to use Playwright Page directly (no MCP)
  - ✅ Custom tool implementations
  - ✅ Better performance (no subprocess overhead)
  - ✅ Enhanced debugging capabilities

- [ ] **API Testing Integration?**
  - [ ] HTTP request/response tools
  - [ ] End‑to‑end API + UI flows

- [ ] **Production Features**
  - [ ] Environment management
  - [ ] Secret management integration
  - [ ] CI/CD pipeline templates
  - [ ] Video tutorials

- [ ] **Advanced Reporting**
  - [ ] AI‑generated test failure analysis
  - [ ] Real‑time test execution dashboard

## Version 1.0

**Focus**: Enterprise‑Ready AI Test Platform

- [ ] **Test Generation**
  - [ ] AI‑powered test creation from specs
  - [ ] Record and replay with AI enhancement
  - [ ] Auto‑generate assertions
  - [ ] Test maintenance suggestions

- [ ] **Advanced Salesforce**
  - [ ] Multi‑org testing

- [ ] **Plugin Ecosystem**
  - [ ] Custom tool creation API

## Research & Experiments 🔬

Ongoing explorations without specific version targets:

- ✅ **Gemini Live API Integration**
  - ✅ Real‑time streaming AI interactions
  - ✅ Experimental live session management
  - ✅ Repetitive loop detection for live sessions
  - ✅ Live test fixtures and examples

- [ ] **Multi‑Agent Collaboration**
  - [ ] Multiple AI agents for different test aspects
  - [ ] Planner + Executor + Validator pattern
  - [ ] Agent specialization (forms, navigation, validation)

- [ ] **Cost Optimization Strategies**
  - [ ] Smart screenshot decision‑making
  - [ ] Differential page analysis
  - ✅ Compressed representation formats
  - ✅ Local vision models for pre‑filtering

- [ ] **Determinism Improvements**
  - [ ] Hybrid AI + traditional selectors
  - [ ] Confidence scoring for actions
  - [ ] Human‑in‑the‑loop for ambiguous cases
  - [ ] Test result stability metrics

- ✅ **Alternative AI Providers via OpenAI API**
  - ✅ Gemini
  - ✅ xAI
  - ✅ Groq
  - ✅ Claude
  - ✅ Local LLMs (Llama, Mistral, Qwen)
  - ✅ Cost/performance comparisons
