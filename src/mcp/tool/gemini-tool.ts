import { FunctionCall, FunctionDeclaration, Tool } from "@google/genai";

export abstract class GeminiTool implements Tool {
    abstract functionDeclarations: FunctionDeclaration[]
    abstract call(specified: FunctionCall, ...args: any[]): Promise<any> | any
}