import { FunctionDeclaration } from '@google/genai'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { config as envConfig } from "dotenv"

envConfig({ quiet: true })

export type ConfigMCP = {
    client: {
        name: string,
        version: string
    },
    server: {
        command: string,
        args: string[],
        env?: Record<string, string> | undefined
    },
}

export type ToolCall = {
    name: string,
    arguments?: Record<string, unknown>
}

export class GeminiServerMCP {
    private client: Client
    private config: ConfigMCP
    private transport: StdioClientTransport
    private ready: Promise<this>
    constructor(config: ConfigMCP) {
        this.config = config
        this.client = new Client(config.client)
        this.ready = this.connect().then(() => this)
    }

    async connect(): Promise<Client> {
        try {
            this.transport = new StdioClientTransport(this.config.server)
            await this.client.connect(this.transport)
            return this.client
        } catch (error) {
            throw new Error(`Failed to connect to ${this.config.client.name} mcp server:\n${error}`)
        }

    }

    async disconnect() {
        await this.transport.close()
        await this.client.close()
    }

    async tools() {
        await this.ready
        return this.client.listTools()
    }

    private cleanSchemaForGemini(schema: any): any {
        if (!schema || typeof schema !== 'object') {
            return schema
        }

        const supportedFields = ['type', 'properties', 'required', 'description', 'items', 'enum']

        return supportedFields.reduce((cleaned, field) => {
            if (field in schema) {
                if (field === 'properties' && typeof schema.properties === 'object') {
                    cleaned.properties = Object.fromEntries(
                        Object.entries(schema.properties).map(([key, value]) =>
                            [key, this.cleanSchemaForGemini(value)]
                        )
                    )
                } else if (field === 'items' && schema.items) {
                    cleaned.items = this.cleanSchemaForGemini(schema.items)
                } else {
                    cleaned[field] = schema[field]
                }
            }
            return cleaned
        }, {} as any)
    }

    async functionDeclarations(): Promise<FunctionDeclaration[]> {
        await this.ready
        return this.tools().then(all => {
            return all.tools.map(tool => {
                return {
                    name: tool.name,
                    description: tool.description,
                    parameters: this.cleanSchemaForGemini(tool.inputSchema),
                }
            })
        })
    }

    async callTool(specified: ToolCall): Promise<any> {
        await this.ready
        return this.client.callTool(specified).then(result => {
            return result
        }).catch(error => {
            console.error(error)
            throw error
        })
    }
}