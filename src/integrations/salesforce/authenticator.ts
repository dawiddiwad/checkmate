import { expect } from '@playwright/test'
import { SalesforceCliHandler } from './cli-handler.js'

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

export class SalesforceAuthenticator {
	private targetOrg!: TargetOrg
	readonly ready: Promise<this>

	constructor(private readonly cli: SalesforceCliHandler) {
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

	getFrontDoorUrl(): string {
		return `${this.getInstanceUrl().toString()}/secur/frontdoor.jsp?sid=${this.getAccessToken()}`
	}
}
