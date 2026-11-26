import { attachActions } from './actions.js'
import { attachBulk, showUndo } from './bulk.js'
import { attachChat } from './chat.js'
import { attachDock, dockRoom } from './dock.js'
import { attachDrawer } from './drawer.js'
import { attachEvidenceViewer } from './evidence-viewer.js'
import { attachFind } from './find.js'
import { attachForms, placeAlert, syncRationale, syncSource } from './forms.js'
import { attachKeyboard } from './keyboard.js'
import { attachLayers } from './layers.js'
import { attachLists } from './lists.js'
import { attachLive, connect } from './live.js'
import { attachMenus } from './menu.js'
import { attachModels } from './models.js'
import { attachMoveOn } from './move-on.js'
import { attachNavigation, focusDecision, focusTarget, listRows, openTarget, settle } from './navigation.js'
import { applyBuild, restoreAreas } from './navigator.js'
import { attachPageForm } from './page-form.js'
import { chatView, replaceAddress, review, state } from './page-state.js'
import { restoreReviewPicks } from './picks.js'
import { attachStatusBar, showHints } from './status-bar.js'
import { attachTheme } from './theme.js'

replaceAddress()
attachForms()
attachTheme()
attachEvidenceViewer()
attachStatusBar()
attachDock()
attachFind()
attachKeyboard()
attachLayers()
attachBulk()
attachActions()
attachNavigation()
attachDrawer()
attachMoveOn()
attachLive()
attachLists()
attachMenus()

const docked = new window.ResizeObserver(() => dockRoom())
for (const element of document.querySelectorAll('[data-bulk], [data-say-strip]')) docked.observe(element)
dockRoom()
document.querySelector('[data-find-open]').hidden = false
showUndo()
if (review && state.chosenBuild) applyBuild()
restoreReviewPicks()
syncRationale()
syncSource()
openTarget()
restoreAreas()
if (location.hash === '#decide' || location.hash === '#answer')
	window.addEventListener('load', () => window.requestAnimationFrame(focusDecision), { once: true })
else if (chatView === 'new') document.querySelector('[data-chat-composer] textarea')?.focus()
else if (review || state.drawer || listRows().length) settle()
else showHints()
if (!review && !state.drawer && !listRows().length)
	window.addEventListener('load', () => placeAlert() || focusTarget(), { once: true })
connect()

attachPageForm()
attachModels()
attachChat()
