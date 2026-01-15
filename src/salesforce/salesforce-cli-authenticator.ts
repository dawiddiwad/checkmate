import { SalesforceCliHandler } from './salesforce-cli-handler'
import { expect } from '@playwright/test'

export type TargetOrg = {
	status: number
	result: {
		id: string
		apiVersion: string
		accessToken: string
		instanceUrl: string
		username: string
		clientId: string
		connectedStatus: string
		sfdxAuthUrl: string
		alias: string
	}
	warnings: string[]
}

export class SalesforceCliAuthenticator {
	private readonly cli: SalesforceCliHandler
	private targetOrg!: TargetOrg
	readonly ready: Promise<this>

	constructor(cliHandler: SalesforceCliHandler) {
		this.cli = cliHandler
		this.ready = this.setTargetOrg().then(() => this)
	}

	private async setTargetOrg() {
		this.targetOrg = (await this.cli.runCommand({
			command: 'org display',
			flags: ['--verbose', '--json'],
		})) as TargetOrg
		expect(this.targetOrg.result.connectedStatus, 'the default target org should be connected').toBe('Connected')
	}

	private getAccessToken(): string {
		return this.targetOrg.result.accessToken
	}

	private getInstanceUrl(): URL {
		return new URL(this.targetOrg.result.instanceUrl)
	}

	public getFrontDoorUrl(): string {
		return `${this.getInstanceUrl().toString()}/secur/frontdoor.jsp?sid=${this.getAccessToken()}`
	}
}
