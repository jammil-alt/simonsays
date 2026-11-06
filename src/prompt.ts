/**
 * Prompt for the clean copy. The JSON shape below is a contract with the renderer
 * in public/app.js (renderWorksheet). Change both together.
 */
export const CLEAN_PROMPT = `The image is a photo or scan of a 2nd-grade homework worksheet. It may be crooked, shadowed, wrinkled or partly cut off.
Rebuild it as clean structured data so a child can type the answers on screen.

Rules:
- Copy every printed word, number and symbol exactly as on the sheet, in reading order. Keep the sheet's own numbering ("1.", "a)").
- Do NOT solve anything. Ignore pencil marks or answers already written by hand: leave those spots as blanks.
- Every place the child must write something becomes a blank. Blank kinds: "number" (a digit answer), "word" (one or a few words), "sentence" (a full line).
- Pictures the child needs (counting objects, clocks, shapes, number lines, coins) become a "figure" item with a short plain description, followed by the question as normal items.
- If a part is unreadable, write [unreadable] in that spot instead of guessing.
- Name/date lines at the top: leave them out.

Reply with ONLY one JSON object of this shape:
{"title": string, "instructions": string|null,
 "sections": [{"heading": string|null, "instructions": string|null, "items": [ITEM, ...]}]}

ITEM is one of:
{"type":"line","label":"1.","parts":["7 + 5 =", {"blank":"number"}]}            (horizontal math, fill-in sentences, compare "34 ( ) 43" -> parts with a blank)
{"type":"vertical","label":"2.","rows":["34","25"],"op":"+"}                     (stacked math problem; the answer blank goes under the line)
{"type":"write","label":"3.","prompt":"Write two sentences about your weekend.","lines":3}
{"type":"choice","label":"4.","prompt":"Which word is a noun?","options":["run","dog","blue"]}
{"type":"wordbank","words":["cat","hat","sat"]}
{"type":"text","text":"A reading passage or note, copied exactly."}
{"type":"figure","description":"A picture of 3 red apples and 4 green apples."}

Example: a row of six stacked addition problems is one section whose items are six "vertical" items.`;
