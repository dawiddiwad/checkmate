import { exec } from 'child_process'

export type CliCommand = {
    command: string,
    flags?: Array<string>,
    log?: boolean
}

export class SalesforceCliHandler {
    private readonly defaultPath: string = 'sf'

    constructor(path?: string) {
        if (path) {
            this.defaultPath = path
        }
    }

    private join(flags: string[]): string {
        return flags.join(' ')
    }

    private ignored(error: string): boolean {
        const ignoredErrorMessages = [
            'debugger',
            'deprecation'
        ]
        return ignoredErrorMessages.some(message => error.includes(message))
    }

    private parseOutputAsJSON(output: string): Record<string, unknown> {
        try {
            const cliColoring = /[\u001b\u009b][[()#?]*(?:[0-9]{1,4}(?:[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g
            output = output.replace(cliColoring, '')
            return JSON.parse(output)
        }
        catch (error) {
            throw new Error(`failed parsing output from:\n${output}\ndue to:\n${error}`)
        }
    }

    public async runCommand({ command, flags, log }: CliCommand): Promise<Record<string, unknown> | string> {
        const compiledArguments = `${this.defaultPath} ${command} ${flags ? this.join(flags) : ''}`
        if (log) {
            console.info(`executing ${this.defaultPath} cli command: ${compiledArguments}`)
        }
        return new Promise<Record<string, unknown> | string>((resolve, reject) => {
            exec(compiledArguments, (error, stdout, stderr) => {
                try {
                    if (error && error.code === 1) {
                        throw new Error(`command failed\nError details:${stdout}\ncaused by:\n${error}`)
                    } else if (stderr && !this.ignored(stderr)) {
                        throw new Error(`command failed\nError details:${stderr}`)
                    } else {
                        if (stdout) {
                            resolve(flags?.includes('--json') ? this.parseOutputAsJSON(stdout) : stdout)
                        } else throw new Error(`missing output from ${this.defaultPath} cli command`)
                    }
                } catch (error) {
                    reject(`failed running ${this.defaultPath} salesforce cli command:\n${compiledArguments}\ncaused by:\n${error}`)
                }
            })
        })
    }
}