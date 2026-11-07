import type { Picture } from "./gemini";
import type { Script } from "./comic-prompt";

/**
 * Fake AI for local development only (MOCK_AI=1 in .dev.vars). Lets the whole Comic Maker flow run
 * without Anthropic or Gemini keys. Never set MOCK_AI in production.
 */
export async function mockScript(story: string): Promise<Script> {
  await new Promise((r) => setTimeout(r, 600));
  const bits = story.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const n = Math.max(4, Math.min(6, bits.length));
  const cast = [
    { name: "Captain Burp", look: "small boy hero, red cape, green goggles, big grin" },
    { name: "Slime King", look: "wobbly lime-green slime blob wearing a tiny gold crown" },
  ];
  return {
    title: "Captain Burp vs. the Slime King",
    characters: cast,
    panels: Array.from({ length: n }, (_, i) => ({
      scene: `Panel ${i + 1}: ${bits[i] || "Everyone laughs in a pudding-covered park."} Captain Burp on the left, Slime King on the right.`,
      characters: cast.map((c) => c.name),
      caption: i === 0 ? "One day..." : i === n - 1 ? "In the end..." : bits[i] ? "Then..." : "",
      dialogue: i % 2 === 0
        ? [{ speaker: "Captain Burp", text: "Time to save the day!", side: "left" as const }, { speaker: "Slime King", text: "Not so fast, goo-face!", side: "right" as const }]
        : [{ speaker: "Slime King", text: "Blorp! My crown is sticky!", side: "right" as const }],
    })),
    changes: /\b(gun|kill)\b/i.test(story) ? ["Changed a real weapon into a goo blaster."] : [],
  };
}

const COLORS = ["#ffd166", "#8ecae6", "#b5e48c", "#ffadad", "#cdb4db", "#ffc6ff"];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function mockPicture(prompt: string, aspect: "1:1" | "4:3", slot: string): Promise<Picture> {
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 900));
  const [w, h] = aspect === "1:1" ? [600, 600] : [800, 600];
  const bg = COLORS[[...slot].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const line = (prompt.split("\n").find((l) => l.startsWith("Scene:") || l.startsWith("Character")) || prompt).slice(0, 160);
  const words = line.split(" "); const rows: string[] = []; let cur = "";
  for (const wd of words) { if ((cur + " " + wd).length > 38) { rows.push(cur); cur = wd; } else cur = cur ? cur + " " + wd : wd; }
  rows.push(cur);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="${bg}"/><rect y="${h * 0.62}" width="100%" height="${h * 0.38}" fill="#7bc96f"/>
<circle cx="${w * 0.25}" cy="${h * 0.62}" r="${h * 0.12}" fill="#e63946" stroke="#111" stroke-width="6"/>
<circle cx="${w * 0.75}" cy="${h * 0.64}" r="${h * 0.14}" fill="#9ef01a" stroke="#111" stroke-width="6"/>
<text x="50%" y="${h * 0.82}" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#111">MOCK ${esc(slot.toUpperCase())}</text>
${rows.map((r, i) => `<text x="50%" y="${h * 0.36 + i * 24}" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#333">${esc(r)}</text>`).join("")}
</svg>`;
  return { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml" };
}
