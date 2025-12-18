import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserTool } from '../step/tool/browser-tool';
import { Page } from '@playwright/test';
import { ToolCall } from '../step/tool/openai-tool';

// Mock logger
vi.mock('../../src/step/openai/openai-test-manager', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock PageSnapshot
vi.mock('../../src/step/tool/page-snapshot', () => ({
  PageSnapshot: class {
    get = vi.fn().mockResolvedValue('mocked snapshot content');
  },
}));

describe('BrowserTool', () => {
  let browserTool: BrowserTool;
  let mockPage: Page;

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        pressSequentially: vi.fn().mockResolvedValue(undefined),
        innerHTML: vi.fn().mockResolvedValue('<html>content</html>'),
      }),
      keyboard: {
        press: vi.fn().mockResolvedValue(undefined),
      },
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as any;

    browserTool = new BrowserTool(mockPage);
  });

  describe('constructor and function declarations', () => {
    it('should create browser tool with 5 function declarations', () => {
      expect(browserTool.functionDeclarations).toHaveLength(5);
    });

    it('should include navigate tool declaration', () => {
      const navigateTool = browserTool.functionDeclarations.find(
        (tool) => tool.function.name === BrowserTool.TOOL_NAVIGATE
      );
      expect(navigateTool).toBeDefined();
      expect(navigateTool?.function.description).toContain('Navigate');
      expect(navigateTool?.function?.parameters?.required).toContain('url');
      expect(navigateTool?.function?.parameters?.required).toContain('goal');
    });

    it('should include click tool declaration', () => {
      const clickTool = browserTool.functionDeclarations.find(
        (tool) => tool.function.name === BrowserTool.TOOL_CLICK
      );
      expect(clickTool).toBeDefined();
      expect(clickTool?.function?.parameters?.required).toContain('ref');
      expect(clickTool?.function?.parameters?.required).toContain('name');
      expect(clickTool?.function?.parameters?.required).toContain('goal');
    });

    it('should include type tool declaration', () => {
      const typeTool = browserTool.functionDeclarations.find(
        (tool) => tool.function.name === BrowserTool.TOOL_TYPE
      );
      expect(typeTool).toBeDefined();
      expect(typeTool?.function?.parameters?.required).toContain('ref');
      expect(typeTool?.function?.parameters?.required).toContain('text');
    });

    it('should include press key tool declaration', () => {
      const pressKeyTool = browserTool.functionDeclarations.find(
        (tool) => tool.function.name === BrowserTool.TOOL_PRESS_KEY
      );
      expect(pressKeyTool).toBeDefined();
      expect(pressKeyTool?.function?.parameters?.required).toContain('key');
    });

    it('should include snapshot tool declaration', () => {
      const snapshotTool = browserTool.functionDeclarations.find(
        (tool) => tool.function.name === BrowserTool.TOOL_SNAPSHOT
      );
      expect(snapshotTool).toBeDefined();
      expect(snapshotTool?.function?.parameters?.required).toContain('goal');
    });
  });

  describe('call method - error handling', () => {
    it('should throw error when tool name is missing', async () => {
      const toolCall: ToolCall = {
        name: undefined as any,
        arguments: {},
      };

      await expect(browserTool.call(toolCall)).rejects.toThrow('Tool name is required');
    });

    it('should throw error for unimplemented tool', async () => {
      const toolCall: ToolCall = {
        name: 'unknown_tool',
        arguments: {},
      };

      await expect(browserTool.call(toolCall)).rejects.toThrow('Browser tool not implemented: unknown_tool');
    });
  });

  describe('navigate', () => {
    it('should navigate to URL and capture snapshot', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_NAVIGATE,
        arguments: { url: 'https://example.com', goal: 'test' },
      };

      const result = await browserTool.call(toolCall);

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com');
      expect(result).toBe('mocked snapshot content');
    });

    it('should throw error when URL is missing', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_NAVIGATE,
        arguments: { url: '', goal: 'test' },
      };

      await expect(browserTool.call(toolCall)).rejects.toThrow('valid URL is required');
    });

    it('should throw error when URL is undefined', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_NAVIGATE,
        arguments: { goal: 'test' },
      };

      await expect(browserTool.call(toolCall)).rejects.toThrow('valid URL is required');
    });

    it('should handle navigation errors', async () => {
      vi.mocked(mockPage.goto).mockRejectedValue(new Error('Network error'));

      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_NAVIGATE,
        arguments: { url: 'https://example.com', goal: 'test' },
      };

      await expect(browserTool.call(toolCall)).rejects.toThrow('Failed to navigate to URL');
    });
  });

  describe('click', () => {
    it('should click element and capture snapshot', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_CLICK,
        arguments: { ref: 'e123', name: 'Submit Button', goal: 'submit form' },
      };

      const result = await browserTool.call(toolCall);

      expect(mockPage.click).toHaveBeenCalledWith('aria-ref=e123');
      expect(result).toBe('mocked snapshot content');
    });

    it('should return error message on click failure', async () => {
      vi.mocked(mockPage.click).mockRejectedValue(new Error('Element not found'));

      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_CLICK,
        arguments: { ref: 'e999', name: 'Button', goal: 'click' },
      };

      const result = await browserTool.call(toolCall);

      expect(result).toContain("failed to click element with ref 'e999'");
      expect(result).toContain('try with different element type or ref');
    });
  });

  describe('type', () => {
    it('should type text into element and capture snapshot', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_TYPE,
        arguments: { ref: 'e456', text: 'Hello World', name: 'Input', goal: 'enter text' },
      };

      const result = await browserTool.call(toolCall);

      expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e456');
      expect(mockPage.locator('aria-ref=e456').pressSequentially).toHaveBeenCalledWith('Hello World', { delay: 50 });
      expect(result).toBe('mocked snapshot content');
    });

    it('should return error message when ref is missing', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_TYPE,
        arguments: { ref: '', text: 'Hello', name: 'Input', goal: 'enter text' },
      };

      const result = await browserTool.call(toolCall);
      expect(result).toContain("failed to type text 'Hello' in element with ref ''");
      expect(result).toContain("both 'ref' and 'text' are required");
    });

    it('should return error message when text is missing', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_TYPE,
        arguments: { ref: 'e456', text: '', name: 'Input', goal: 'enter text' },
      };

      const result = await browserTool.call(toolCall);
      expect(result).toContain("failed to type text '' in element with ref 'e456'");
      expect(result).toContain("both 'ref' and 'text' are required");
    });

    it('should return error message on type failure', async () => {
      vi.mocked(mockPage.locator).mockReturnValue({
        pressSequentially: vi.fn().mockRejectedValue(new Error('Element not found')),
      } as any);

      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_TYPE,
        arguments: { ref: 'e999', text: 'test', name: 'Input', goal: 'enter text' },
      };

      const result = await browserTool.call(toolCall);

      expect(result).toContain("failed to type text 'test' in element with ref 'e999'");
      expect(result).toContain('try with different element type or ref');
    });
  });

  describe('pressKey', () => {
    it('should press key and capture snapshot', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_PRESS_KEY,
        arguments: { key: 'Enter', goal: 'submit' },
      };

      const result = await browserTool.call(toolCall);

      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
      expect(result).toBe('mocked snapshot content');
    });

    it('should throw error when key is missing', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_PRESS_KEY,
        arguments: { key: '', goal: 'submit' },
      };

      await expect(browserTool.call(toolCall)).rejects.toThrow("'key' is required");
    });

    it('should handle press key errors', async () => {
      vi.mocked(mockPage.keyboard.press).mockRejectedValue(new Error('Key not recognized'));

      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_PRESS_KEY,
        arguments: { key: 'InvalidKey', goal: 'test' },
      };

      await expect(browserTool.call(toolCall)).rejects.toThrow("Failed to press key 'InvalidKey'");
    });
  });

  describe('snapshot', () => {
    it('should capture snapshot', async () => {
      const toolCall: ToolCall = {
        name: BrowserTool.TOOL_SNAPSHOT,
        arguments: { goal: 'capture current state' },
      };

      const result = await browserTool.call(toolCall);

      expect(result).toBe('mocked snapshot content');
    });
  });

  describe('tool name constants', () => {
    it('should have correct tool name constants', () => {
      expect(BrowserTool.TOOL_NAVIGATE).toBe('browser_navigate');
      expect(BrowserTool.TOOL_CLICK).toBe('browser_click');
      expect(BrowserTool.TOOL_TYPE).toBe('browser_type');
      expect(BrowserTool.TOOL_PRESS_KEY).toBe('browser_press_key');
      expect(BrowserTool.TOOL_SNAPSHOT).toBe('browser_snapshot');
    });
  });
});
