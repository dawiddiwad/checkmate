import { GenerateContentConfig, FunctionCallingConfigMode, Tool } from "@google/genai"

export class ConfigurationManager {
    getModel(): string {
        return process.env.GOOGLE_API_MODEL ?? "gemini-2.5-flash"
    }

    getApiKey(): string {
        return process.env.GOOGLE_API_KEY ?? ""
    }

    async buildConfig(tools: Tool[]): Promise<GenerateContentConfig> {
        return {
            temperature: this.getTemperature(),
            httpOptions: {
                timeout: this.getTimeout()
            },
            tools,
            toolConfig: {
                functionCallingConfig: {
                    allowedFunctionNames: this.getAllowedFunctionNames(),
                    mode: FunctionCallingConfigMode.ANY
                }
            }
        }
    }

    private getTemperature(): number {
        return parseFloat(process.env.GOOGLE_API_TEMPERATURE ?? "0")
    }

    private getTimeout(): number {
        return parseInt(process.env.GOOGLE_API_TIMEOUT_SECONDS ?? "10") * 1000
    }

    private getAllowedFunctionNames(): string[] {
        return [
            "browser_click",
            "browser_evaluate",
            "browser_fill_form",
            "browser_handle_dialog",
            "browser_hover",
            "browser_navigate",
            "browser_press_key",
            "browser_select_option",
            "browser_snapshot",
            "browser_type",
            "browser_wait_for",
            "fail_test_step",
            "pass_test_step",
            "get_salesforce_login_url"
        ]
    }
}