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

- [ ] **OpenAI API Migration**
  - [x] Move from Gemini API to OpenAI API
  - [ ] Implement abstract costing interface

- [ ] **Comprehensive Documentation**
  - [x] README with setup instructions
  - [x] Roadmap document
  - [x] Environment configuration examples
  - [x] Architecture diagrams
  - [ ] Video tutorials
  - [x] Best practices guide

- [ ] **Enhanced Playwright Fixtures**
  - [ ] Screenshots in reports
  - [ ] Videos in reports

- [ ] **Usage Monitoring & Limits**
  - [x] Basic token counting per step
  - [x] Cost calculation per test
  - [x] Token usage tracking per component
  - [ ] Budget limits and alerts
  - [x] Compress YAML page snapshots

- [ ] **Error Handling & Timeouts**
  - [x] Automatic retry logic with exponential backoff
  - [x] API request timeouts (configurable)
  - [x] Graceful handling of API failures
  - [x] Tool-level timeouts (30s default)
  - [x] Better error messages with recovery suggestions
  - [x] Fallback strategies when AI fails
  - [ ] Circuit breaker for repeated failures

- [ ] **Guardrails**
  - [x] Experimental repetitive loop detection (live API)
  - [ ] Detect and prevent identical tool calls (max 3 in a row)
  - [x] Tool response timeout retry logic
  - [ ] Maximum tokens per step limit
  - [x] Rate limiting for API calls

- [ ] **Logging & Post-Processing**
  - [x] Detailed step execution logging
  - [x] Token usage logging per step
  - [ ] Structured logging (JSON format)
  - [ ] Log levels (DEBUG, INFO, WARN, ERROR)
  - [ ] Execution trace with timing
  - [ ] AI reasoning/thought capture


## Version 0.3

**Focus**: UI, Performance, Visual Testing

- [ ] **UI Layer V1**
  - [ ] Automatic test generation from recorded actions (video and streaming)
  - [ ] Drag-and-drop test step builder
  - [ ] Real-time test execution viewer
  - [ ] Run, Pause, Resume, Re-start ability
  - [ ] Commit/Read test cases in native playwright format

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

- [ ] **Visual Testing**
  - [ ] AI-powered visual validation
  - [ ] Layout consistency checks

## Version 0.4

**Focus**: Production Readiness & Scaling

- [ ] **Standalone Playwright Integration?**
  - [ ] Option to use Playwright Page directly (no MCP)
  - [ ] Custom tool implementations
  - [ ] Better performance (no subprocess overhead)
  - [ ] Enhanced debugging capabilities
  - [ ] Compare MCP vs standalone approaches

- [ ] **API Testing Integration?**
  - [ ] HTTP request/response tools
  - [ ] End-to-end API + UI flows

- [ ] **Production Features**
  - [ ] Environment management
  - [ ] Secret management integration
  - [ ] CI/CD pipeline templates

- [ ] **Advanced Reporting**
  - [ ] Real-time test execution dashboard
  - [ ] AI-generated test failure analysis

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
  - [ ] Compressed representation formats
  - [ ] Local vision models for pre-filtering

- [ ] **Determinism Improvements**
  - [ ] Hybrid AI + traditional selectors
  - [ ] Confidence scoring for actions
  - [ ] Human-in-the-loop for ambiguous cases
  - [ ] Test result stability metrics

- [ ] **Alternative AI Providers**
  - [ ] GPT
  - [ ] GROK
  - [ ] Claude
  - [ ] Local LLMs (Llama, Mistral, Qwen)
  - [ ] Cost/performance comparisons