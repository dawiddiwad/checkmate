# Checkmate Roadmap 🗺️

This roadmap outlines the planned features and improvements for checkmate.

## Version 0.1 (Current - Experimental) 🚧

**Status**: ✅ Complete

- [x] Core Gemini integration with function calling
- [x] Playwright MCP server integration
- [x] Natural language test specifications
- [x] Basic token usage monitoring
- [x] Screenshot compression for cost optimization
- [x] Chat history filtering
- [x] Salesforce CLI integration
- [x] Multi-project test organization
- [x] HTML and JUnit reporting
- [x] Enhanced architecture with modular components
- [x] Retry logic and error handling
- [x] Configuration management system
- [x] Experimental Gemini Live API integration

## Version 0.2 (In Progress)

**Focus**: OpenAI API, Stability, Observability, and Cost Control

- [x] **OpenAI API Migration**
  - [x] Move from Gemini API to OpenAI API

- [ ] **Comprehensive Documentation**
  - [x] README with setup instructions
  - [x] Roadmap document
  - [x] Environment configuration examples
  - [x] Architecture diagrams
  - [ ] Video tutorials
  - [x] Best practices guide

- [x] **Playwright Test Migration from MCP server**
  - [x] Native browser, context and page handling
  - [x] Screenshots/videos/all browser events in reports
  - [x] Snapshot screenshots as blobs
  - [x] Normalized configuration and context

- [x] **Usage Monitoring & Limits**
  - [x] Basic token counting per step
  - [x] Cost calculation per test
  - [x] Token usage tracking per component
  - [x] Budget limits
  - [x] Compress YAML page snapshots

- [x] **Error Handling & Timeouts**
  - [x] Automatic retry logic with exponential backoff
  - [x] API request timeouts (configurable)
  - [x] Graceful handling of API failures
  - [x] Tool-level timeouts (30s default)
  - [x] Better error messages with recovery suggestions
  - [x] Fallback strategies when AI fails
  - [x] Circuit breaker for repeated failures

- [x] **Guardrails**
  - [x] Experimental repetitive loop detection (live API)
  - [x] Detect and prevent identical tool calls (max 3 in a row)
  - [x] Tool response timeout retry logic
  - [x] Maximum tokens per step limit
  - [x] Rate limiting for API calls

- [ ] **Logging & Post-Processing**
  - [x] Detailed step execution logging
  - [x] Token usage logging per step
  - [x] Structured logging (JSON format)
  - [x] Log levels (DEBUG, INFO, WARN, ERROR)
  - [x] AI reasoning/thought capture
  - [ ] AI-generated test failure analysis


## Version 0.3

**Focus**: UI, E2E modes, Visual Testing

- [ ] **UI Layer V1**
  - [ ] Automatic test generation from recorded actions (video and streaming)
  - [ ] Drag-and-drop test step builder
  - [ ] Real-time test execution viewer
  - [ ] Run, Pause, Resume, Re-start ability
  - [ ] Commit/Read test cases in native playwright format

- [ ] **E2E modes**
  - [ ] step-by-step (hard) assertions mode
  - [ ] step-by-step (soft) assertions mode
  - [ ] flow mode using a set of E2E goals as assertions rather than discrete steps:
    - [ ] execution is driven by a plan, which can be:
      - [ ] text (natural language description of the desired workflow)
      - [ ] video (recording of an example execution)
      - [ ] step-by-step test case written in natural language (Playwright test spec)
    - [ ] tests are spawned in series (e.g., 10) using controlled temperature jitter to promote slight variance for each run. At the end, the average pass rate is used to calculate an E2E flow health-check score

- [ ] **Visual Testing**
  - [ ] Proper screenshot scaling for Playwright MCP vision tools

## Version 0.4

**Focus**: Performance, Production Readiness & Scaling

- [ ] **Explicit Caching?**
  - [ ] Cache common page structures
  - [ ] Cache UI element mappings
  - [ ] Intelligent cache invalidation

- [ ] **RAG-Based Element Retrieval?**
  - [ ] Store page snapshots in Gemini File API
  - [ ] Vector search for relevant UI elements
  - [ ] New `page_focused_snapshot` tool
  - [ ] Handles large/complex pages efficiently
  - [ ] Reduces token consumption by 60%

- [x] **Standalone Playwright Integration?**
  - [x] Option to use Playwright Page directly (no MCP)
  - [x] Custom tool implementations
  - [x] Better performance (no subprocess overhead)
  - [x] Enhanced debugging capabilities

- [ ] **API Testing Integration?**
  - [ ] HTTP request/response tools
  - [ ] End-to-end API + UI flows

- [ ] **Production Features**
  - [ ] Environment management
  - [ ] Secret management integration
  - [ ] CI/CD pipeline templates

- [ ] **Advanced Reporting**
  - [ ] Real-time test execution dashboard

## Version 1.0

**Focus**: Enterprise-Ready AI Test Platform

- [ ] **Test Generation**
  - [ ] AI-powered test creation from specs
  - [ ] Record and replay with AI enhancement
  - [ ] Auto-generate assertions
  - [ ] Test maintenance suggestions

- [ ] **Advanced Salesforce**
  - [ ] Multi-org testing

- [ ] **Plugin Ecosystem**
  - [ ] Custom tool creation API

## Research & Experiments 🔬

Ongoing explorations without specific version targets:

- [x] **Gemini Live API Integration**
  - [x] Real-time streaming AI interactions
  - [x] Experimental live session management
  - [x] Repetitive loop detection for live sessions
  - [x] Live test fixtures and examples

- [ ] **Multi-Agent Collaboration**
  - [ ] Multiple AI agents for different test aspects
  - [ ] Planner + Executor + Validator pattern
  - [ ] Agent specialization (forms, navigation, validation)

- [ ] **Cost Optimization Strategies**
  - [ ] Smart screenshot decision-making
  - [ ] Differential page analysis
  - [x] Compressed representation formats
  - [x] Local vision models for pre-filtering

- [ ] **Determinism Improvements**
  - [ ] Hybrid AI + traditional selectors
  - [ ] Confidence scoring for actions
  - [ ] Human-in-the-loop for ambiguous cases
  - [ ] Test result stability metrics

- [ ] **Alternative AI Providers**
  - [x] GPT
  - [x] GROK
  - [ ] Claude
  - [x] Local LLMs (Llama, Mistral, Qwen)
  - [x] Cost/performance comparisons