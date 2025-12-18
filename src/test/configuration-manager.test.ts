import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigurationManager } from '../step/configuration-manager';

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    configManager = new ConfigurationManager();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getApiKey', () => {
    it('should return API key when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'test-api-key-123';
      expect(configManager.getApiKey()).toBe('test-api-key-123');
    });

    it('should throw error when OPENAI_API_KEY is not set', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => configManager.getApiKey()).toThrow('OPENAI_API_KEY environment variable is not set');
    });

    it('should throw error when OPENAI_API_KEY is empty string', () => {
      process.env.OPENAI_API_KEY = '';
      expect(() => configManager.getApiKey()).toThrow('OPENAI_API_KEY environment variable is not set');
    });
  });

  describe('getBaseURL', () => {
    it('should return base URL when OPENAI_BASE_URL is set', () => {
      process.env.OPENAI_BASE_URL = 'https://custom.api.com';
      expect(configManager.getBaseURL()).toBe('https://custom.api.com');
    });

    it('should return undefined when OPENAI_BASE_URL is not set', () => {
      delete process.env.OPENAI_BASE_URL;
      expect(configManager.getBaseURL()).toBeUndefined();
    });
  });

  describe('getModel', () => {
    it('should return configured model when OPENAI_MODEL is set', () => {
      process.env.OPENAI_MODEL = 'gpt-4o';
      expect(configManager.getModel()).toBe('gpt-4o');
    });

    it('should return default model "gpt-5-mini" when OPENAI_MODEL is not set', () => {
      delete process.env.OPENAI_MODEL;
      expect(configManager.getModel()).toBe('gpt-5-mini');
    });

    it('should return empty string if explicitly set to empty', () => {
      process.env.OPENAI_MODEL = '';
      expect(configManager.getModel()).toBe('');
    });
  });

  describe('getMaxRetries', () => {
    it('should return configured max retries when OPENAI_RETRY_MAX_ATTEMPTS is set', () => {
      process.env.OPENAI_RETRY_MAX_ATTEMPTS = '5';
      expect(configManager.getMaxRetries()).toBe(5);
    });

    it('should return default 3 when OPENAI_RETRY_MAX_ATTEMPTS is not set', () => {
      delete process.env.OPENAI_RETRY_MAX_ATTEMPTS;
      expect(configManager.getMaxRetries()).toBe(3);
    });

    it('should parse zero correctly', () => {
      process.env.OPENAI_RETRY_MAX_ATTEMPTS = '0';
      expect(configManager.getMaxRetries()).toBe(0);
    });

    it('should return NaN for invalid numeric string', () => {
      process.env.OPENAI_RETRY_MAX_ATTEMPTS = 'invalid';
      expect(configManager.getMaxRetries()).toBeNaN();
    });
  });

  describe('includeScreenshotInSnapshot', () => {
    it('should return true when set to "true"', () => {
      process.env.OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT = 'true';
      expect(configManager.includeScreenshotInSnapshot()).toBe(true);
    });

    it('should return true when set to "TRUE" (case insensitive)', () => {
      process.env.OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT = 'TRUE';
      expect(configManager.includeScreenshotInSnapshot()).toBe(true);
    });

    it('should return false when set to "false"', () => {
      process.env.OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT = 'false';
      expect(configManager.includeScreenshotInSnapshot()).toBe(false);
    });

    it('should return false when not set', () => {
      delete process.env.OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT;
      expect(configManager.includeScreenshotInSnapshot()).toBe(false);
    });

    it('should return false for any other value', () => {
      process.env.OPENAI_INCLUDE_SCREENSHOT_IN_SNAPSHOT = 'yes';
      expect(configManager.includeScreenshotInSnapshot()).toBe(false);
    });
  });

  describe('getToolChoice', () => {
    it('should return "required" when set to "required"', () => {
      process.env.OPENAI_TOOL_CHOICE = 'required';
      expect(configManager.getToolChoice()).toBe('required');
    });

    it('should return "auto" when set to "auto"', () => {
      process.env.OPENAI_TOOL_CHOICE = 'auto';
      expect(configManager.getToolChoice()).toBe('auto');
    });

    it('should return "none" when set to "none"', () => {
      process.env.OPENAI_TOOL_CHOICE = 'none';
      expect(configManager.getToolChoice()).toBe('none');
    });

    it('should return "required" as default when not set', () => {
      delete process.env.OPENAI_TOOL_CHOICE;
      expect(configManager.getToolChoice()).toBe('required');
    });

    it('should be case insensitive', () => {
      process.env.OPENAI_TOOL_CHOICE = 'REQUIRED';
      expect(configManager.getToolChoice()).toBe('required');
    });

    it('should return "required" for invalid value', () => {
      process.env.OPENAI_TOOL_CHOICE = 'invalid';
      expect(configManager.getToolChoice()).toBe('required');
    });
  });

  describe('getTemperature', () => {
    it('should return configured temperature when OPENAI_TEMPERATURE is set', () => {
      process.env.OPENAI_TEMPERATURE = '0.5';
      expect(configManager.getTemperature()).toBe(0.5);
    });

    it('should return default 1 when OPENAI_TEMPERATURE is not set', () => {
      delete process.env.OPENAI_TEMPERATURE;
      expect(configManager.getTemperature()).toBe(1);
    });

    it('should parse zero correctly', () => {
      process.env.OPENAI_TEMPERATURE = '0';
      expect(configManager.getTemperature()).toBe(0);
    });

    it('should parse high temperature correctly', () => {
      process.env.OPENAI_TEMPERATURE = '2';
      expect(configManager.getTemperature()).toBe(2);
    });

    it('should return NaN for invalid numeric string', () => {
      process.env.OPENAI_TEMPERATURE = 'invalid';
      expect(configManager.getTemperature()).toBeNaN();
    });
  });

  describe('getTimeout', () => {
    it('should return timeout in milliseconds when OPENAI_TIMEOUT_SECONDS is set', () => {
      process.env.OPENAI_TIMEOUT_SECONDS = '30';
      expect(configManager.getTimeout()).toBe(30000);
    });

    it('should return default 60000ms (60 seconds) when not set', () => {
      delete process.env.OPENAI_TIMEOUT_SECONDS;
      expect(configManager.getTimeout()).toBe(60000);
    });

    it('should handle zero timeout', () => {
      process.env.OPENAI_TIMEOUT_SECONDS = '0';
      expect(configManager.getTimeout()).toBe(0);
    });

    it('should handle large timeout values', () => {
      process.env.OPENAI_TIMEOUT_SECONDS = '300';
      expect(configManager.getTimeout()).toBe(300000);
    });
  });

  describe('getAllowedFunctionNames', () => {
    it('should return array of function names when OPENAI_ALLOWED_TOOLS is set', () => {
      process.env.OPENAI_ALLOWED_TOOLS = 'func1,func2,func3';
      expect(configManager.getAllowedFunctionNames()).toEqual(['func1', 'func2', 'func3']);
    });

    it('should trim whitespace from function names', () => {
      process.env.OPENAI_ALLOWED_TOOLS = 'func1 , func2 , func3';
      expect(configManager.getAllowedFunctionNames()).toEqual(['func1', 'func2', 'func3']);
    });

    it('should return empty array when OPENAI_ALLOWED_TOOLS is not set', () => {
      delete process.env.OPENAI_ALLOWED_TOOLS;
      expect(configManager.getAllowedFunctionNames()).toEqual([]);
    });

    it('should return empty array when OPENAI_ALLOWED_TOOLS is empty string', () => {
      process.env.OPENAI_ALLOWED_TOOLS = '';
      expect(configManager.getAllowedFunctionNames()).toEqual([]);
    });

    it('should return empty array when OPENAI_ALLOWED_TOOLS is only whitespace', () => {
      process.env.OPENAI_ALLOWED_TOOLS = '   ';
      expect(configManager.getAllowedFunctionNames()).toEqual([]);
    });

    it('should filter out empty entries', () => {
      process.env.OPENAI_ALLOWED_TOOLS = 'func1,,func2,  ,func3';
      expect(configManager.getAllowedFunctionNames()).toEqual(['func1', 'func2', 'func3']);
    });

    it('should handle single function name', () => {
      process.env.OPENAI_ALLOWED_TOOLS = 'singleFunc';
      expect(configManager.getAllowedFunctionNames()).toEqual(['singleFunc']);
    });
  });

  describe('getTokenBudgetUSD', () => {
    it('should return USD budget when OPENAI_API_TOKEN_BUDGET_USD is set', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_USD = '10.50';
      expect(configManager.getTokenBudgetUSD()).toBe(10.50);
    });

    it('should return undefined when OPENAI_API_TOKEN_BUDGET_USD is not set', () => {
      delete process.env.OPENAI_API_TOKEN_BUDGET_USD;
      expect(configManager.getTokenBudgetUSD()).toBeUndefined();
    });

    it('should return undefined for invalid numeric string', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_USD = 'invalid';
      expect(configManager.getTokenBudgetUSD()).toBeUndefined();
    });

    it('should parse zero correctly', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_USD = '0';
      expect(configManager.getTokenBudgetUSD()).toBe(0);
    });

    it('should handle large decimal values', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_USD = '1000.999';
      expect(configManager.getTokenBudgetUSD()).toBe(1000.999);
    });

    it('should handle negative values (implementation allows it)', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_USD = '-5';
      expect(configManager.getTokenBudgetUSD()).toBe(-5);
    });
  });

  describe('getTokenBudgetCount', () => {
    it('should return token count budget when OPENAI_API_TOKEN_BUDGET_COUNT is set', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_COUNT = '100000';
      expect(configManager.getTokenBudgetCount()).toBe(100000);
    });

    it('should return undefined when OPENAI_API_TOKEN_BUDGET_COUNT is not set', () => {
      delete process.env.OPENAI_API_TOKEN_BUDGET_COUNT;
      expect(configManager.getTokenBudgetCount()).toBeUndefined();
    });

    it('should return undefined for invalid numeric string', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_COUNT = 'invalid';
      expect(configManager.getTokenBudgetCount()).toBeUndefined();
    });

    it('should parse zero correctly', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_COUNT = '0';
      expect(configManager.getTokenBudgetCount()).toBe(0);
    });

    it('should handle large integer values', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_COUNT = '999999999';
      expect(configManager.getTokenBudgetCount()).toBe(999999999);
    });

    it('should truncate decimal values to integer', () => {
      process.env.OPENAI_API_TOKEN_BUDGET_COUNT = '100.7';
      expect(configManager.getTokenBudgetCount()).toBe(100);
    });
  });

  describe('getLoopMaxRepetitions', () => {
    it('should return configured max repetitions when OPENAI_LOOP_MAX_REPETITIONS is set', () => {
      process.env.OPENAI_LOOP_MAX_REPETITIONS = '10';
      expect(configManager.getLoopMaxRepetitions()).toBe(10);
    });

    it('should return default 5 when OPENAI_LOOP_MAX_REPETITIONS is not set', () => {
      delete process.env.OPENAI_LOOP_MAX_REPETITIONS;
      expect(configManager.getLoopMaxRepetitions()).toBe(5);
    });

    it('should return default 5 for invalid numeric string', () => {
      process.env.OPENAI_LOOP_MAX_REPETITIONS = 'invalid';
      expect(configManager.getLoopMaxRepetitions()).toBe(5);
    });

    it('should parse zero correctly', () => {
      process.env.OPENAI_LOOP_MAX_REPETITIONS = '0';
      expect(configManager.getLoopMaxRepetitions()).toBe(0);
    });

    it('should handle large values', () => {
      process.env.OPENAI_LOOP_MAX_REPETITIONS = '100';
      expect(configManager.getLoopMaxRepetitions()).toBe(100);
    });
  });

  describe('getReasoningEffort', () => {
    it('should return "low" when set to "low"', () => {
      process.env.OPENAI_REASONING_EFFORT = 'low';
      expect(configManager.getReasoningEffort()).toBe('low');
    });

    it('should return "medium" when set to "medium"', () => {
      process.env.OPENAI_REASONING_EFFORT = 'medium';
      expect(configManager.getReasoningEffort()).toBe('medium');
    });

    it('should return "high" when set to "high"', () => {
      process.env.OPENAI_REASONING_EFFORT = 'high';
      expect(configManager.getReasoningEffort()).toBe('high');
    });

    it('should return undefined when not set', () => {
      delete process.env.OPENAI_REASONING_EFFORT;
      expect(configManager.getReasoningEffort()).toBeUndefined();
    });

    it('should be case insensitive', () => {
      process.env.OPENAI_REASONING_EFFORT = 'HIGH';
      expect(configManager.getReasoningEffort()).toBe('high');
    });

    it('should return undefined for invalid value', () => {
      process.env.OPENAI_REASONING_EFFORT = 'invalid';
      expect(configManager.getReasoningEffort()).toBeUndefined();
    });
  });

  describe('getLogLevel', () => {
    it('should return "debug" when set to "debug"', () => {
      process.env.CHECKMATE_LOG_LEVEL = 'debug';
      expect(configManager.getLogLevel()).toBe('debug');
    });

    it('should return "info" when set to "info"', () => {
      process.env.CHECKMATE_LOG_LEVEL = 'info';
      expect(configManager.getLogLevel()).toBe('info');
    });

    it('should return "warn" when set to "warn"', () => {
      process.env.CHECKMATE_LOG_LEVEL = 'warn';
      expect(configManager.getLogLevel()).toBe('warn');
    });

    it('should return "error" when set to "error"', () => {
      process.env.CHECKMATE_LOG_LEVEL = 'error';
      expect(configManager.getLogLevel()).toBe('error');
    });

    it('should return "off" when set to "off"', () => {
      process.env.CHECKMATE_LOG_LEVEL = 'off';
      expect(configManager.getLogLevel()).toBe('off');
    });

    it('should return default "off" when not set', () => {
      delete process.env.CHECKMATE_LOG_LEVEL;
      expect(configManager.getLogLevel()).toBe('off');
    });

    it('should be case insensitive', () => {
      process.env.CHECKMATE_LOG_LEVEL = 'DEBUG';
      expect(configManager.getLogLevel()).toBe('debug');
    });

    it('should return default "off" for invalid value', () => {
      process.env.CHECKMATE_LOG_LEVEL = 'invalid';
      expect(configManager.getLogLevel()).toBe('off');
    });
  });
});
