import { CHAT_TAG, HelpwingChatElement } from './chat.js'
import { HelpwingLauncherElement, LAUNCHER_TAG } from './launcher.js'

/** Registers `<helpwing-chat>` and `<helpwing-launcher>`. Safe to call more than once. */
export function defineHelpwingElements(): void {
  if (typeof customElements === 'undefined') return
  if (!customElements.get(CHAT_TAG)) customElements.define(CHAT_TAG, HelpwingChatElement)
  if (!customElements.get(LAUNCHER_TAG)) customElements.define(LAUNCHER_TAG, HelpwingLauncherElement)
}

declare global {
  interface HTMLElementTagNameMap {
    'helpwing-chat': HelpwingChatElement
    'helpwing-launcher': HelpwingLauncherElement
  }
}
