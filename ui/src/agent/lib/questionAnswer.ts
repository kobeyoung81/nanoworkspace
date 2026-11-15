/**
 * One question's answer text, as the agent receives it.
 *
 * The answer is a plain string per question: everything the user picked, plus
 * whatever they typed in the free-text field. Kept out of the card so the rule
 * (trim, and never repeat a label the custom text already matches) is unit
 * tested rather than only exercised by hand.
 */
export function composeAnswer(picked: string[], custom: string): string {
  const text = custom.trim()
  const all = text && !picked.includes(text) ? [...picked, text] : picked
  return all.join(', ')
}
