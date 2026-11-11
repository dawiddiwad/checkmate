#!/usr/bin/env node
import { main } from '../src/cli.ts'
import { runUi } from '../../cli/src/ui/command.ts'

const argv = process.argv.slice(2)
if (argv[0] === 'ui') await runUi(argv.slice(1))
else main(argv)
