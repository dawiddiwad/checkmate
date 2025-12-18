import { describe, it, expect, beforeEach } from 'vitest';
import { LoopDetector, LoopDetectedError } from '../step/tool/loop-detector';
import { ToolCall } from '../step/tool/openai-tool';

describe('LoopDetector', () => {
  let loopDetector: LoopDetector;
  const MAX_REPETITIONS = 5;

  beforeEach(() => {
    loopDetector = new LoopDetector(MAX_REPETITIONS);
  });

  describe('basic pattern detection', () => {
    it('should detect simple single-tool loop', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value' },
      };

      // Record the same tool call 5 times
      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall);
        }
      }).toThrow(LoopDetectedError);
    });

    it('should not detect loop with fewer repetitions than threshold', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value' },
      };

      // Record the same tool call 4 times (one less than threshold)
      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS - 1; i++) {
          loopDetector.recordToolCall(toolCall);
        }
      }).not.toThrow();
    });

    it('should detect two-tool alternating pattern loop', () => {
      const toolCall1: ToolCall = {
        name: 'tool_a',
        arguments: { id: 1 },
      };
      const toolCall2: ToolCall = {
        name: 'tool_b',
        arguments: { id: 2 },
      };

      // Record pattern [tool_a, tool_b] 5 times (10 total calls)
      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall1);
          loopDetector.recordToolCall(toolCall2);
        }
      }).toThrow(LoopDetectedError);
    });

    it('should detect three-tool repeating pattern loop', () => {
      const toolCall1: ToolCall = { name: 'tool_a', arguments: {} };
      const toolCall2: ToolCall = { name: 'tool_b', arguments: {} };
      const toolCall3: ToolCall = { name: 'tool_c', arguments: {} };

      // Record pattern [tool_a, tool_b, tool_c] 5 times (15 total calls)
      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall1);
          loopDetector.recordToolCall(toolCall2);
          loopDetector.recordToolCall(toolCall3);
        }
      }).toThrow(LoopDetectedError);
    });
  });

  describe('tool signature creation', () => {
    it('should differentiate tools with same name but different arguments', () => {
      const toolCall1: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value1' },
      };
      const toolCall2: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value2' },
      };

      // Should not detect loop since arguments differ
      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS * 2; i++) {
          loopDetector.recordToolCall(i % 2 === 0 ? toolCall1 : toolCall2);
        }
      }).toThrow(LoopDetectedError); // Will detect as alternating pattern
    });

    it('should handle tools with no arguments', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: {},
      };

      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall);
        }
      }).toThrow(LoopDetectedError);
    });

    it('should handle tools with undefined arguments', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
      };

      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall);
        }
      }).toThrow(LoopDetectedError);
    });

    it('should sort argument keys for consistent signatures', () => {
      const toolCall1: ToolCall = {
        name: 'test_tool',
        arguments: { b: 2, a: 1, c: 3 },
      };
      const toolCall2: ToolCall = {
        name: 'test_tool',
        arguments: { a: 1, c: 3, b: 2 }, // Same args, different order
      };

      // Should detect loop since arguments are identical (just ordered differently)
      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(i % 2 === 0 ? toolCall1 : toolCall2);
        }
      }).toThrow(LoopDetectedError);
    });

    it('should handle complex nested argument objects', () => {
      const toolCall: ToolCall = {
        name: 'complex_tool',
        arguments: {
          nested: { deep: { value: 123 } },
          array: [1, 2, 3],
          string: 'test',
        },
      };

      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall);
        }
      }).toThrow(LoopDetectedError);
    });
  });

  describe('reset behavior', () => {
    it('should reset history to empty', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value' },
      };

      // Record some tool calls
      loopDetector.recordToolCall(toolCall);
      loopDetector.recordToolCall(toolCall);
      loopDetector.recordToolCall(toolCall);

      expect(loopDetector.getHistoryLength()).toBe(3);

      // Reset
      loopDetector.reset();

      expect(loopDetector.getHistoryLength()).toBe(0);
      expect(loopDetector.getHistory()).toEqual([]);
    });

    it('should allow same pattern after reset without detecting loop', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value' },
      };

      // Record 3 times
      loopDetector.recordToolCall(toolCall);
      loopDetector.recordToolCall(toolCall);
      loopDetector.recordToolCall(toolCall);

      // Reset
      loopDetector.reset();

      // Record 3 more times - should not throw since we reset
      expect(() => {
        loopDetector.recordToolCall(toolCall);
        loopDetector.recordToolCall(toolCall);
        loopDetector.recordToolCall(toolCall);
      }).not.toThrow();
    });

    it('should reset automatically after detecting loop', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value' },
      };

      // Trigger loop detection
      try {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall);
        }
      } catch (e) {
        expect(e).toBeInstanceOf(LoopDetectedError);
      }

      // History should be reset after exception
      expect(loopDetector.getHistoryLength()).toBe(0);
    });
  });

  describe('LoopDetectedError', () => {
    it('should include pattern information in error', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value' },
      };

      try {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(LoopDetectedError);
        const loopError = error as LoopDetectedError;
        expect(loopError.loopResult.loopDetected).toBe(true);
        expect(loopError.loopResult.patternLength).toBe(1);
        expect(loopError.loopResult.repetitions).toBeGreaterThanOrEqual(MAX_REPETITIONS);
        expect(loopError.loopResult.pattern).toHaveLength(1);
        expect(loopError.loopResult.pattern[0]).toContain('test_tool');
        expect(loopError.status).toBe('TOOL_CALL_LOOP');
      }
    });

    it('should include pattern details for multi-tool loop', () => {
      const toolCall1: ToolCall = { name: 'tool_a', arguments: {} };
      const toolCall2: ToolCall = { name: 'tool_b', arguments: {} };

      try {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(toolCall1);
          loopDetector.recordToolCall(toolCall2);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(LoopDetectedError);
        const loopError = error as LoopDetectedError;
        expect(loopError.loopResult.patternLength).toBe(2);
        expect(loopError.loopResult.pattern).toHaveLength(2);
        expect(loopError.message).toContain('tool_a');
        expect(loopError.message).toContain('tool_b');
        expect(loopError.message).toContain('->');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty history', () => {
      expect(loopDetector.getHistoryLength()).toBe(0);
      expect(loopDetector.getHistory()).toEqual([]);
    });

    it('should handle single tool call', () => {
      const toolCall: ToolCall = {
        name: 'test_tool',
        arguments: { param: 'value' },
      };

      expect(() => {
        loopDetector.recordToolCall(toolCall);
      }).not.toThrow();

      expect(loopDetector.getHistoryLength()).toBe(1);
    });

    it('should not detect loop with varied patterns', () => {
      const toolCalls: ToolCall[] = [
        { name: 'tool_a', arguments: {} },
        { name: 'tool_b', arguments: {} },
        { name: 'tool_c', arguments: {} },
        { name: 'tool_d', arguments: {} },
        { name: 'tool_e', arguments: {} },
      ];

      // Record different tools - no loop should be detected
      expect(() => {
        toolCalls.forEach(toolCall => loopDetector.recordToolCall(toolCall));
      }).not.toThrow();
    });

    it('should detect loop starting after some non-looping calls', () => {
      const toolCall1: ToolCall = { name: 'tool_a', arguments: {} };
      const toolCall2: ToolCall = { name: 'tool_b', arguments: {} };
      const loopingToolCall: ToolCall = { name: 'looping_tool', arguments: {} };

      // Record some non-repeating calls first
      loopDetector.recordToolCall(toolCall1);
      loopDetector.recordToolCall(toolCall2);

      // Then start a loop
      expect(() => {
        for (let i = 0; i < MAX_REPETITIONS; i++) {
          loopDetector.recordToolCall(loopingToolCall);
        }
      }).toThrow(LoopDetectedError);
    });

    it('should work with max repetitions set to 1', () => {
      const fastLoopDetector = new LoopDetector(1);
      const toolCall: ToolCall = { name: 'test_tool', arguments: {} };

      // With maxRepetitions=1, we need at least 1 repetition to detect
      // That means the pattern needs to appear at least twice
      // First call establishes the pattern
      expect(() => {
        fastLoopDetector.recordToolCall(toolCall);
      }).not.toThrow();

      // Second call should trigger detection (pattern repeated once)
      expect(() => {
        fastLoopDetector.recordToolCall(toolCall);
      }).toThrow(LoopDetectedError);
    });

    it('should work with large max repetitions', () => {
      const slowLoopDetector = new LoopDetector(100);
      const toolCall: ToolCall = { name: 'test_tool', arguments: {} };

      // Should not detect until 100 repetitions
      expect(() => {
        for (let i = 0; i < 99; i++) {
          slowLoopDetector.recordToolCall(toolCall);
        }
      }).not.toThrow();

      expect(() => {
        slowLoopDetector.recordToolCall(toolCall);
      }).toThrow(LoopDetectedError);
    });
  });

  describe('getHistory and getHistoryLength', () => {
    it('should return copy of history array', () => {
      const toolCall: ToolCall = { name: 'test_tool', arguments: {} };
      
      loopDetector.recordToolCall(toolCall);
      const history = loopDetector.getHistory();
      
      // Modify the returned array
      history.push('fake_signature');
      
      // Original history should be unchanged
      expect(loopDetector.getHistory()).toHaveLength(1);
      expect(loopDetector.getHistory()).not.toContain('fake_signature');
    });

    it('should correctly report history length as tools are added', () => {
      const toolCall: ToolCall = { name: 'test_tool', arguments: {} };
      
      expect(loopDetector.getHistoryLength()).toBe(0);
      
      loopDetector.recordToolCall(toolCall);
      expect(loopDetector.getHistoryLength()).toBe(1);
      
      loopDetector.recordToolCall(toolCall);
      expect(loopDetector.getHistoryLength()).toBe(2);
      
      loopDetector.recordToolCall(toolCall);
      expect(loopDetector.getHistoryLength()).toBe(3);
    });
  });
});
