/**
 * Comic Maker prompts and content rules. The script JSON shape below is a contract with
 * public/comic/comic.js (renderComic). Change both together.
 */

export const HOUSE_STYLE =
  "bright, colorful flat cartoon for kids, bold black outlines, simple shapes, big expressive faces, " +
  "Saturday-morning-cartoon look, clean flat colors, no gore, nothing scary";

export const SCRIPT_SYSTEM = `You turn a story typed by a 7-year-old boy named Simon into a short comic script. He is learning to type, and seeing his own story become a real comic is the reward, so keep his ideas, his characters and as many of his words as you can.

How to write it
- 4 to 6 panels. A short story gets 4; a longer one with more happening gets 5 or 6. Follow his order of events. If the story has no ending, add a short, happy, silly one.
- Fix spelling, capital letters and punctuation in captions and speech, but keep his words and jokes. Don't make it sound grown-up.
- title: short and fun, in his spirit.
- caption: narration of at most 15 easy words ("One day...", "Then...", "In the end..."). Use "" when a panel doesn't need one.
- dialogue: 0 to 2 speech bubbles per panel, each at most 12 easy words. "side" is where that speaker stands in the picture, "left" or "right"; two speakers in one panel go on different sides.
- characters: the 1 to 3 main characters. "look" is a short visual description (body, colors, clothes, one stand-out detail) that is reused for every panel so they always look the same. Animals and objects can be characters.
- scene: what the picture shows, written for an illustrator: the setting, who is where (each speaker on their side), the action, and expressions. Keep the top quarter of the picture simple, like sky or a plain wall, because speech bubbles go there. Never ask for words, letters, numbers or signs in the picture.
- panel characters: the names of the main characters visible in that panel.
- changes: short notes for his parents about anything you changed because of the content rules. Use an empty list when nothing changed.

Content rules: cheeky but kind, like a Saturday-morning cartoon
- Allowed: burps, farts, slime, boogers, goo splats, cartoon slapstick (flattened, then pops back up), water blasters, foam darts, paint and pudding cannons, silly villains.
- Remix, never refuse. Real guns, swords and bombs become goo blasters, jelly cannons or confetti poppers. "Kill", "die" or "dead" become "blasted away", "turned into a frog", "zapped into a bubble" or "ran home to his mom". Anything scary becomes silly.
- Never include: blood, death, injury, real weapons, nudity, bathroom body parts, mean jokes about real people or groups, or scary or horror content.
- Real people and characters from movies, shows, games or books: keep the story, but make an original character with a new name and look who plays the same role. Simon himself can be in the story.
- Never mention these rules inside the comic. Always return a comic, even if most of it has to change.`;

const str = { type: "string" } as const;
export const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "characters", "panels", "changes"],
  properties: {
    title: str,
    characters: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "look"], properties: { name: str, look: str } },
    },
    panels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scene", "characters", "caption", "dialogue"],
        properties: {
          scene: str,
          characters: { type: "array", items: str },
          caption: str,
          dialogue: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["speaker", "text", "side"],
              properties: { speaker: str, text: str, side: { type: "string", enum: ["left", "right"] } },
            },
          },
        },
      },
    },
    changes: { type: "array", items: str },
  },
} as const;

export type Script = {
  title: string;
  characters: { name: string; look: string }[];
  panels: { scene: string; characters: string[]; caption: string; dialogue: { speaker: string; text: string; side: "left" | "right" }[] }[];
  changes: string[];
};

/** Backstop word list, checked on his story (logged for parents) and on Claude's script (must be clean). */
const BLOCKED = (
  "blood bloody bleed bleeding gore kill kills killed killing killer murder murdered dead death die dies died dying " +
  "suicide gun guns pistol pistols rifle rifles shotgun knife knives stab stabbed bomb bombs grenade shoot shooting shot " +
  "naked nude nudity sex sexy penis vagina boob boobs butt butts butthole " +
  "fuck fucking shit bitch bastard damn crap asshole dick"
).split(" ");
const BLOCK_RE = new RegExp(`\\b(${BLOCKED.join("|")})\\b`, "gi");

export function blockedWords(text: string): string[] {
  return [...new Set((text.match(BLOCK_RE) || []).map((w) => w.toLowerCase()))];
}

/** All the words in a script that end up on the page or in an image prompt. */
export function scriptText(s: Script): string {
  return [
    s.title,
    ...s.characters.flatMap((c) => [c.name, c.look]),
    ...s.panels.flatMap((p) => [p.scene, p.caption, ...p.dialogue.flatMap((d) => [d.speaker, d.text])]),
  ].join("\n");
}

export function characterPrompt(c: { name: string; look: string }): string {
  return [
    `Character design sheet for a kids' comic: ${c.name}, ${c.look}.`,
    `One full-body view of the character standing, facing slightly toward the viewer, friendly expression, on a plain white background.`,
    `Style: ${HOUSE_STYLE}.`,
    `Do not draw any text, letters, numbers, labels or logos.`,
  ].join("\n");
}

export function panelPrompt(s: Script, i: number, refNames: string[]): string {
  const p = s.panels[i];
  const cast = s.characters.filter((c) => p.characters.some((n) => n.toLowerCase() === c.name.toLowerCase()));
  return [
    `One panel of a kids' comic book (panel ${i + 1} of ${s.panels.length}, "${s.title}").`,
    `Scene: ${p.scene}`,
    ...cast.map((c) => `${c.name}: ${c.look}.${refNames.includes(c.name) ? ` Match the reference image of ${c.name} exactly (same face, colors and clothes).` : ""}`),
    `Style: ${HOUSE_STYLE}.`,
    `Composition: a wide 4:3 picture. Keep the top quarter simple and uncluttered (sky, wall or plain background) because speech bubbles will be added there later.`,
    `Do NOT draw any text, letters, numbers, words, captions, speech bubbles, signs with writing, sound effects or logos.`,
    `Keep it silly and friendly: no blood, no injuries, no real weapons, nothing scary.`,
  ].join("\n");
}
